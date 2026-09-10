// Push Center — turn a window of Square orders into OrderFacts for the
// customer-state fold. Takes the client as an argument (no `server-only`)
// so the backfill script and the cron route share one scan.

import type { Square, SquareClient } from "square";
import type { Channel, OrderFact } from "./customer-state";

export function channelOf(order: Square.Order): Channel {
  if (order.source?.name === "Point of Sale") return "pos";
  const meta = (order.metadata ?? {}) as Record<string, string>;
  if (meta.source === "app") return "app";
  if (meta.source === "web") return "web";
  return "other";
}

/** Paid, or completed: the two shapes a real order takes at scan time. */
export function countsAsOrder(order: Square.Order): boolean {
  if (order.state === "CANCELED" || order.state === "DRAFT") return false;
  if (order.state === "COMPLETED") return true;
  return (order.tenders ?? []).length > 0;
}

export function toFact(order: Square.Order): OrderFact | null {
  if (!order.id || !order.customerId || !order.createdAt) return null;
  if (!countsAsOrder(order)) return null;
  const items: OrderFact["items"] = [];
  for (const li of order.lineItems ?? []) {
    if (li.itemType && li.itemType !== "ITEM") continue;
    if (!li.name) continue;
    const qty = Number(li.quantity ?? "1");
    items.push({ name: li.name, qty: Number.isFinite(qty) && qty > 0 ? qty : 1 });
  }
  return {
    id: order.id,
    customerId: order.customerId,
    createdAt: order.createdAt,
    channel: channelOf(order),
    items,
  };
}

/**
 * Every order created in [startAt, endAt] that counts. Pages at 500;
 * `onPage` lets a long backfill report progress.
 */
export async function scanOrders(
  client: SquareClient,
  locationId: string,
  window: { startAt: string; endAt: string },
  onPage?: (page: number, total: number) => void,
): Promise<OrderFact[]> {
  const out: OrderFact[] = [];
  let cursor: string | undefined;
  let page = 0;
  do {
    const resp = await client.orders.search({
      locationIds: [locationId],
      limit: 500,
      cursor,
      query: {
        filter: {
          dateTimeFilter: { createdAt: { startAt: window.startAt, endAt: window.endAt } },
          stateFilter: { states: ["OPEN", "COMPLETED"] },
        },
        sort: { sortField: "CREATED_AT", sortOrder: "ASC" },
      },
    });
    for (const o of resp.orders ?? []) {
      const f = toFact(o);
      if (f) out.push(f);
    }
    cursor = resp.cursor ?? undefined;
    page++;
    onPage?.(page, out.length);
  } while (cursor);
  return out;
}
