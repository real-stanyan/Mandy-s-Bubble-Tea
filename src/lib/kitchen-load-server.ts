import "server-only";
import { squareClient, SQUARE_LOCATION_ID } from "@/lib/square";
import { kitchenLoadFor, type KitchenLoad } from "@/lib/kitchen-load";

// The kitchen's queue right now, in cups — the input to the ASAP estimate
// (see kitchen-load.ts for the brackets).
//
// What counts as "in the queue": every order at the shop — web, App and
// POS alike, because the barista makes them all from the same bench —
// created in the last LOOKBACK window, still OPEN, whose fulfillment
// hasn't reached PREPARED (ready) or COMPLETED / CANCELED. A drink that is
// already on the counter isn't ahead of the new customer; a drink whose
// ticket hasn't printed yet is.
//
// The lookback is the honest ceiling on how long a not-yet-ready order
// can plausibly still be on the bench. Past it, an OPEN/PROPOSED order is
// almost always a stale one Square never closed (self-delivery keeps
// state OPEN forever, see history route) — counting those would pin the
// estimate at "busy" all day.
//
// Cached for CACHE_TTL_MS: /api/store-status is polled every 30s by every
// open checkout, and one Square search per 30s per instance is plenty.
// Failure is null, never a guess — the caller shows the middle bracket.
const LOOKBACK_MS = 20 * 60 * 1000;
const CACHE_TTL_MS = 30_000;
const DONE_STATES = new Set(["PREPARED", "COMPLETED", "CANCELED", "FAILED"]);

let cache: { value: KitchenLoad | null; fetchedAt: number } | null = null;

export function __resetKitchenLoadCacheForTests(): void {
  cache = null;
}

/** Cups on the bench right now, or null when Square can't be asked. */
export async function countPendingCups(now: Date = new Date()): Promise<number | null> {
  if (!SQUARE_LOCATION_ID) return null;
  try {
    const res = await squareClient.orders.search({
      locationIds: [SQUARE_LOCATION_ID],
      limit: 100,
      query: {
        filter: {
          stateFilter: { states: ["OPEN"] },
          dateTimeFilter: {
            createdAt: { startAt: new Date(now.getTime() - LOOKBACK_MS).toISOString() },
          },
        },
        sort: { sortField: "CREATED_AT", sortOrder: "DESC" },
      },
    });
    let cups = 0;
    for (const order of res.orders ?? []) {
      const state = order.fulfillments?.[0]?.state ?? "PROPOSED";
      if (DONE_STATES.has(state)) continue;
      for (const li of order.lineItems ?? []) {
        // Custom-amount / non-catalog lines aren't drinks.
        if (li.itemType && li.itemType !== "ITEM") continue;
        const q = Number(li.quantity ?? "1");
        cups += Number.isFinite(q) && q > 0 ? q : 1;
      }
    }
    return cups;
  } catch (err) {
    console.error(
      "[kitchen-load] Square search failed:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/** The bracketed estimate for the queue right now, or null when the queue
 *  can't be measured (the UI then shows KITCHEN_LOAD_FALLBACK). */
export async function getKitchenLoad(now: Date = new Date()): Promise<KitchenLoad | null> {
  const t = now.getTime();
  if (cache && t - cache.fetchedAt < CACHE_TTL_MS) return cache.value;
  const cups = await countPendingCups(now);
  const value = cups == null ? null : kitchenLoadFor(cups);
  cache = { value, fetchedAt: t };
  return value;
}
