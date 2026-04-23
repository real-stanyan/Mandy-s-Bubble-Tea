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

// Square fulfillment state is inconsistent between channels — POS
// walk-in tickets get rung up and marked COMPLETED within ~1 second
// of createdAt (state never reflects drink prep), while online orders
// can sit in PROPOSED for hours after pickup because staff rarely flip
// them. Instead of trusting state, treat every order as "still cooking"
// until its naked prep time has naturally elapsed.
//
// The lookback window below just bounds the Square search cost — any
// order older than this is long done regardless.
const QUEUE_LOOKBACK_MINUTES = 30;

// Per-order slack added to raw cup prep time before deciding the drink
// is "done". Covers sealing, sticker print, and customer pickup delay.
const ORDER_PREP_BUFFER_MINUTES = 1;

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

// Naked prep time for a single order — unique SKUs only (staff batch
// duplicates), summed at that SKU's perCup rate.
function orderPrepMinutes(
  lineItems: Square.OrderLineItem[] | null | undefined,
  slugsByVariation: Map<string, Set<string>>,
): number {
  const skus = new Set<string>();
  collectVariations(lineItems, slugsByVariation, skus);
  let total = 0;
  for (const id of skus) total += perCupMinutes(slugsByVariation.get(id));
  return total;
}

/**
 * Estimated wait (minutes) until `order` is ready at the pickup counter.
 *
 *   wait = BASE_MINUTES
 *        + Σ perCup(sku) for every distinct drink SKU in the pipeline
 *
 * "Pipeline" = (this order's line items) ∪ (every order at this
 * location — POS walk-in and online alike — created strictly before
 * this order within the lookback window AND whose naked prep time has
 * not yet elapsed at `order.createdAt`).
 *
 * Whether the drink is still being made is estimated from the order's
 * own contents (`createdAt + unique-SKU prep + buffer`), not from
 * Square's fulfillment state — POS tickets skip PROPOSED entirely and
 * online tickets often linger in PROPOSED for hours after pickup, so
 * state is an unreliable signal for batch prep tracking.
 *
 * Identical SKUs across the pipeline are counted once — a staff member
 * shakes duplicates together, so two Grapefruits ahead plus your own
 * Grapefruit are one minute of prep, not three.
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
            // OPEN covers online tickets still mid-prep; COMPLETED covers
            // POS walk-in tickets that Square auto-closes in ~1 second.
            stateFilter: { states: ["OPEN", "COMPLETED"] },
            dateTimeFilter: {
              createdAt: {
                endAt: order.createdAt,
                ...(startAtIso ? { startAt: startAtIso } : {}),
              },
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
        if (!other.createdAt) continue;
        // Square's endAt is inclusive; guard strict "before" ourselves.
        if (other.createdAt >= order.createdAt) continue;
        const otherCreatedMs = Date.parse(other.createdAt);
        if (!Number.isFinite(otherCreatedMs)) continue;
        const prepMin = orderPrepMinutes(other.lineItems, slugsByVariation);
        const estDoneMs =
          otherCreatedMs + (prepMin + ORDER_PREP_BUFFER_MINUTES) * 60_000;
        // Naked prep time elapsed by the time this order was placed →
        // that drink is already on the counter, not blocking us.
        if (Number.isFinite(endAtMs) && estDoneMs <= endAtMs) continue;
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
