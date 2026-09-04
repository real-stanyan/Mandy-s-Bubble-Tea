import "server-only";
import { squareClient, SQUARE_LOCATION_ID } from "@/lib/square";
import { kitchenLoadFor, type KitchenLoad } from "@/lib/kitchen-load";

// The kitchen's queue right now, in cups — the input to the ASAP estimate
// (see kitchen-load.ts for the brackets).
//
// Square's order state is no use for this: the POS completes a walk-in the
// moment it's paid, and the register marks online pickups COMPLETED just
// as fast (2026-09-04 lunch: all 30 orders of the previous 90 minutes were
// COMPLETED / fulfillment COMPLETED while the bench was clearly working).
// A first cut that counted OPEN orders therefore read "quiet, 0 cups" all
// day. So busyness is measured as cups ORDERED in the last LOOKBACK
// window, across every channel — web, App and POS share one bench. The
// window encodes a throughput assumption of roughly a cup a minute: a cup
// ordered ten minutes ago is on the counter; the ones from the last few
// minutes are not. Tune LOOKBACK_MS / the brackets together if the floor
// says the estimates run hot or cold.
//
// Scheduled pickups are held back by the print queue until shortly before
// their time, so one booked for an hour ahead isn't on the bench yet and
// isn't counted until it is. (A scheduled order created before the window
// but being made now is missed — rare, and the brackets are coarse.)
//
// Cached for CACHE_TTL_MS: /api/store-status is polled every 30s by every
// open checkout, and one Square search per 30s per instance is plenty.
// Failure is null, never a guess — the caller shows the middle bracket.
const LOOKBACK_MS = 10 * 60 * 1000;
/** How far ahead of pickupAt a scheduled ticket is released to the bench
 *  — the print queue's make lead. */
const SCHEDULED_RELEASE_MS = 5 * 60 * 1000;
const CACHE_TTL_MS = 30_000;

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
          dateTimeFilter: {
            createdAt: { startAt: new Date(now.getTime() - LOOKBACK_MS).toISOString() },
          },
        },
        sort: { sortField: "CREATED_AT", sortOrder: "DESC" },
      },
    });
    let cups = 0;
    for (const order of res.orders ?? []) {
      if (order.state === "CANCELED" || order.state === "DRAFT") continue;
      const fulfillment = order.fulfillments?.[0];
      if (fulfillment?.state === "CANCELED" || fulfillment?.state === "FAILED") continue;
      const pickup = fulfillment?.pickupDetails;
      if (pickup?.scheduleType === "SCHEDULED" && pickup.pickupAt) {
        const at = Date.parse(pickup.pickupAt);
        if (Number.isFinite(at) && at - now.getTime() > SCHEDULED_RELEASE_MS) continue;
      }
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
