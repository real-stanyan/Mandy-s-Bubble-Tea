import "server-only";
import type { Square } from "square";
import { squareClient, SQUARE_LOCATION_ID } from "@/lib/square";
import { getMenu, type Menu } from "@/lib/catalog";

// Drinks in these categories take 1.5 minutes per cup; everything else
// is 1 minute. Slugs are the canonical slugify() output of the Square
// category names.
const SLOW_SLUGS = new Set(["cheese-cream", "frozen"]);

export const MAX_WAIT_MINUTES = 15;
const BASE_MINUTES = 1;

// Square fulfillment state isn't always closed out promptly — POS
// tickets often linger in PROPOSED for hours or days after the drink
// was handed over. Only orders created within this many minutes of the
// target order actually represent "people in line ahead of you"; anything
// older is stale queue noise.
const QUEUE_LOOKBACK_MINUTES = 30;

function buildVariationSlugMap(menu: Menu): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const record = (variationId: string, slug: string) => {
    const set = map.get(variationId) ?? new Set<string>();
    set.add(slug);
    map.set(variationId, set);
  };
  for (const [slug, items] of menu.itemsBySlug.entries()) {
    for (const item of items) {
      for (const v of item.variations) record(v.id, slug);
    }
  }
  return map;
}

function perCupMinutes(slugs: Set<string> | undefined): number {
  if (!slugs) return 0;
  for (const slug of slugs) if (SLOW_SLUGS.has(slug)) return 1.5;
  return 1;
}

function collectVariations(
  lineItems: Square.OrderLineItem[] | null | undefined,
  slugsByVariation: Map<string, Set<string>>,
  into: Set<string>,
): void {
  for (const li of lineItems ?? []) {
    const variationId = li.catalogObjectId;
    if (!variationId) continue;
    // Unmapped line items (fees, gift cards, removed products) don't
    // belong to a drink queue — skip them rather than guessing.
    if (!slugsByVariation.has(variationId)) continue;
    const qty = parseInt(li.quantity ?? "1", 10);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    into.add(variationId);
  }
}

/**
 * Estimated wait (minutes) until `order` is ready at the pickup counter.
 *
 *   wait = BASE_MINUTES
 *        + Σ perCup(sku) for every distinct drink SKU in the pipeline
 *
 * "Pipeline" = (this order's line items) ∪ (every OPEN order at this
 * location whose PICKUP fulfillment is still PROPOSED or RESERVED and
 * whose createdAt is strictly before this order, within the last
 * QUEUE_LOOKBACK_MINUTES). Identical SKUs across all of those orders
 * are counted once — a staff member batches duplicates in one shake,
 * so two Grapefruit Black Teas ahead of you plus your own Grapefruit
 * are one minute of prep, not three.
 *
 * Capped at MAX_WAIT_MINUTES. On any Square failure the queue
 * contribution is dropped rather than thrown — the confirmation page
 * still needs to render.
 */
export async function estimateOrderWaitMinutes(
  order: Square.Order,
): Promise<number> {
  const menu = await getMenu();
  const slugsByVariation = buildVariationSlugMap(menu);

  const pipeline = new Set<string>();
  collectVariations(order.lineItems, slugsByVariation, pipeline);

  if (SQUARE_LOCATION_ID && order.createdAt) {
    const endAtMs = Date.parse(order.createdAt);
    const startAtIso = Number.isFinite(endAtMs)
      ? new Date(endAtMs - QUEUE_LOOKBACK_MINUTES * 60_000).toISOString()
      : undefined;
    try {
      const res = await squareClient.orders.search({
        locationIds: [SQUARE_LOCATION_ID],
        limit: 200,
        query: {
          filter: {
            stateFilter: { states: ["OPEN"] },
            dateTimeFilter: {
              createdAt: {
                endAt: order.createdAt,
                ...(startAtIso ? { startAt: startAtIso } : {}),
              },
            },
            fulfillmentFilter: {
              fulfillmentStates: ["PROPOSED", "RESERVED"],
            },
          },
          sort: {
            sortField: "CREATED_AT",
            sortOrder: "DESC",
          },
        },
      });
      for (const other of res.orders ?? []) {
        if (other.id === order.id) continue;
        // Square's endAt is inclusive; guard strict "before" ourselves.
        if (other.createdAt && other.createdAt >= order.createdAt) continue;
        collectVariations(other.lineItems, slugsByVariation, pipeline);
      }
    } catch {
      // Queue lookup failed — fall back to counting only the user's own
      // SKUs plus the base minute.
    }
  }

  let total = BASE_MINUTES;
  for (const variationId of pipeline) {
    total += perCupMinutes(slugsByVariation.get(variationId));
  }
  return Math.min(MAX_WAIT_MINUTES, total);
}

export function formatWaitRange(minutes: number): string {
  const capped = Math.min(MAX_WAIT_MINUTES, Math.max(BASE_MINUTES, minutes));
  if (capped >= MAX_WAIT_MINUTES) return `${MAX_WAIT_MINUTES}+ mins`;
  const low = Math.max(1, Math.floor(capped));
  const high = Math.min(MAX_WAIT_MINUTES, Math.ceil(capped) + 1);
  if (low === high) return `${low} min`;
  return `${low}–${high} mins`;
}
