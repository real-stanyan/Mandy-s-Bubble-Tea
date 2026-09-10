// Push Center — move the customer state forward by one window of orders.
// Client-agnostic so the cron route, the "Refresh now" button and the
// backfill script all run the same code.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SquareClient } from "square";
import { foldOrders, groupByCustomer, type CustomerStateRow } from "./customer-state";
import { scanOrders } from "./square-orders";
import { loadStates, readCursor, upsertStates, writeCursor } from "./state-store";

/**
 * Orders younger than this are left for the next run: an app order is paid a
 * few seconds after it is created, but "a few" is not zero, and an unpaid
 * order scanned once is never looked at again.
 */
export const SETTLE_LAG_MS = 10 * 60 * 1000;
/** Longest window one run will take on, so a stalled cursor catches up in steps. */
export const MAX_WINDOW_MS = 7 * 86_400_000;

export type RefreshResult =
  | { ran: false; reason: "no-cursor" | "nothing-new" }
  | {
      ran: true;
      window: { startAt: string; endAt: string };
      orders: number;
      customers: number;
      caughtUp: boolean;
    };

export async function refreshCustomerState(deps: {
  square: SquareClient;
  locationId: string;
  admin: SupabaseClient;
  now?: Date;
  onPage?: (page: number, total: number) => void;
}): Promise<RefreshResult> {
  const now = deps.now ?? new Date();
  const state = await readCursor(deps.admin);
  // Without a cursor there is no safe starting point; the backfill script
  // sets one. Refusing beats a surprise 120-day scan inside a request.
  if (!state) return { ran: false, reason: "no-cursor" };

  const startMs = Date.parse(state.cursor);
  const settled = now.getTime() - SETTLE_LAG_MS;
  if (!(settled > startMs)) return { ran: false, reason: "nothing-new" };
  const endMs = Math.min(settled, startMs + MAX_WINDOW_MS);
  // One millisecond past the cursor: Square's filter is inclusive on both
  // ends, and the fold dedupes by id anyway.
  const window = { startAt: new Date(startMs + 1).toISOString(), endAt: new Date(endMs).toISOString() };

  const orders = await scanOrders(deps.square, deps.locationId, window, deps.onPage);
  const grouped = groupByCustomer(orders);
  const existing = await loadStates(deps.admin, [...grouped.keys()]);
  const rows: CustomerStateRow[] = [];
  for (const [customerId, list] of grouped) {
    rows.push(foldOrders(existing.get(customerId) ?? null, list, now));
  }
  await upsertStates(deps.admin, rows);
  await writeCursor(deps.admin, {
    cursor: window.endAt,
    lastRun: { at: now.toISOString(), orders: orders.length, customers: rows.length, window },
  });
  return { ran: true, window, orders: orders.length, customers: rows.length, caughtUp: endMs === settled };
}
