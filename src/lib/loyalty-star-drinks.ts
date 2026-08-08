import "server-only";
import { squareClient } from "@/lib/square";

// Which drink earned each star of the current loyalty cycle.
//
// The membership card draws its progress as one pip per star; this maps each
// FILLED pip to the actual cup that earned it, so the row reads as "the drinks
// I've had", not nine abstract stars. Square keeps everything needed: every
// ACCUMULATE_POINTS event carries its order id, and the order carries the
// line items.
//
// Best-effort by design. A star with no traceable drink — a manual adjustment,
// a refund clawback, an order Square won't return, more points than cups on
// the order — resolves to null and the card falls back to a plain star for
// that pip. Progress must never look wrong because attribution failed.

export type AccrualEvent = {
  /** Stars this event granted. */
  points: number;
  /** Order that earned them, when Square recorded one. */
  orderId: string | null;
};

/**
 * Pair the current cycle's stars with drink names.
 *
 * Pure — the part with rules in it, split from the fetching so it can be
 * tested without Square. `events` come NEWEST FIRST (Square's searchEvents
 * order); `linesByOrder` maps order id to cup names in line order, one entry
 * per cup. Returns exactly `currentStars` entries, OLDEST first, so index i
 * lines up with filled pip i on the card.
 *
 * Only the newest `currentStars` stars are attributed: anything older belongs
 * to a cycle that was already redeemed away, and after a redemption the
 * balance wraps but the events remain.
 */
export function assignStarDrinks(
  events: AccrualEvent[],
  linesByOrder: Record<string, string[]>,
  currentStars: number,
): Array<string | null> {
  if (currentStars <= 0) return [];

  const newestFirst: Array<string | null> = [];
  for (const e of events) {
    if (newestFirst.length >= currentStars) break;
    const pts = Number.isFinite(e.points) ? Math.floor(e.points) : 0;
    if (pts <= 0) continue;
    const cups = e.orderId ? (linesByOrder[e.orderId] ?? null) : null;
    for (let i = 0; i < pts && newestFirst.length < currentStars; i++) {
      // One star per cup, paired by index. Points beyond the order's cup
      // count (a promo multiplier, a partial refund) have no drink to name.
      newestFirst.push(cups?.[i] ?? null);
    }
  }
  // Balance says more stars than the events account for (an ADJUST_POINTS
  // top-up, or history past the fetch limit): pad the shortfall as unknown.
  while (newestFirst.length < currentStars) newestFirst.push(null);

  return newestFirst.reverse();
}

/**
 * Fetch + attribute in one call. Returns null when Square can't answer —
 * callers treat that the same as "no attribution" and keep plain stars.
 */
export async function starDrinksForAccount(
  loyaltyAccountId: string,
  currentStars: number,
): Promise<Array<string | null> | null> {
  if (currentStars <= 0) return [];
  try {
    const resp = await squareClient.loyalty.searchEvents({
      query: {
        filter: {
          loyaltyAccountFilter: { loyaltyAccountId },
          typeFilter: { types: ["ACCUMULATE_POINTS"] },
        },
      },
      // Worst case a 12-star cycle of single-cup orders needs 12 events;
      // 30 leaves slack for interleaved zero-point noise.
      limit: 30,
    });

    const events: AccrualEvent[] = (resp.events ?? []).map((e) => ({
      points: Number(e.accumulatePoints?.points ?? 0),
      orderId: e.accumulatePoints?.orderId ?? null,
    }));

    const orderIds = [
      ...new Set(
        events.map((e) => e.orderId).filter((id): id is string => id != null),
      ),
    ].slice(0, 20);

    const linesByOrder: Record<string, string[]> = {};
    if (orderIds.length > 0) {
      const res = await squareClient.orders.batchGet({ orderIds });
      for (const o of res.orders ?? []) {
        if (!o.id) continue;
        const cups: string[] = [];
        for (const li of o.lineItems ?? []) {
          const qty = Math.max(1, Number(li.quantity ?? "1") || 1);
          const name = li.name ?? "";
          for (let i = 0; i < qty; i++) cups.push(name);
        }
        linesByOrder[o.id] = cups;
      }
    }

    return assignStarDrinks(events, linesByOrder, currentStars);
  } catch (err) {
    console.error(
      "[star-drinks] attribution failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
