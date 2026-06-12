// src/lib/tier-toppings.ts
/**
 * Diamond-tier free toppings: pure allocation math (isomorphic — the
 * orders route sizes the real FIXED_AMOUNT discount with it, the
 * checkout page mirrors it for preview).
 *
 * Rules: only PAID toppings (price > 0) count against the monthly quota;
 * most-expensive-first (max value to customer); cups covered by loyalty
 * rewards are excluded (their toppings are already free).
 */

export type CupRecord = {
  /** Full cup price (variation + modifiers) — matches pickPromoCups units. */
  unitPrice: bigint;
  /** Catalog price of each topping/modifier on this cup. */
  toppingPrices: bigint[];
};

/**
 * Paid topping unit prices across cups, sorted most-expensive-first.
 * `excludeRewardCount` cheapest cups (by unitPrice, stable ties — same
 * ordering pickPromoCups uses) are excluded from the pool.
 */
export function collectPaidToppingUnits(
  cups: CupRecord[],
  excludeRewardCount: number,
): bigint[] {
  const exclude = Math.max(0, Math.floor(excludeRewardCount));
  const kept = [...cups]
    .sort((a, b) => (a.unitPrice < b.unitPrice ? -1 : a.unitPrice > b.unitPrice ? 1 : 0))
    .slice(Math.min(exclude, cups.length));
  return kept
    .flatMap((c) => c.toppingPrices.filter((p) => p > 0n))
    .sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
}

/** Cover up to `remaining` toppings from a most-expensive-first pool. */
export function coverFreeToppings(
  toppingUnitsDesc: bigint[],
  remaining: number,
): { coveredCount: number; amount: bigint } {
  const take = Math.min(Math.max(0, Math.floor(remaining)), toppingUnitsDesc.length);
  let amount = 0n;
  for (let i = 0; i < take; i++) amount += toppingUnitsDesc[i];
  return { coveredCount: take, amount };
}
