// Bulk-order policy (Stan, 2026-08-17): 10+ cups earns a tiered whole-order
// discount, EXCLUSIVE of every other percentage promo — the bracket is the
// deal, full stop. Above 50 cups self-serve checkout is blocked outright:
// a surprise 80-cup order is a production incident for a two-person counter,
// so those go through a human (Rick) instead.
//
// Applied inside computeOrderPricing, which both /api/orders and
// /api/orders/quote call — so a customer who never opens the chat and builds
// a 20-cup cart straight from the menu still gets the 15% at checkout.

/** Inclusive brackets, highest first so find() picks the right one. */
export const BULK_TIERS = [
  { minCups: 30, maxCups: 50, percent: 20 },
  { minCups: 20, maxCups: 29, percent: 15 },
  { minCups: 10, maxCups: 19, percent: 10 },
] as const;

/** Above this, self-serve checkout refuses the order. */
export const BULK_SELF_SERVE_MAX_CUPS = 50;

/** The /api/orders refusal for a 50+ cup cart. order-block.ts matches on
 *  "over 50 cups" to turn this into a friendly dialog — keep that phrase. */
export const BULK_TOO_LARGE_MESSAGE =
  "Bulk orders over 50 cups can't be placed online — tell Mandy in the chat (or ring the store) and Rick will be in touch to arrange it.";

export function cupCountFor(lines: { quantity: number }[]): number {
  return lines.reduce((sum, l) => sum + Math.max(1, Math.floor(l.quantity)), 0);
}

/** The bracket's percentage for this many cups, or 0 when no bracket fits
 *  (fewer than 10, or more than the self-serve maximum). */
export function bulkDiscountPercent(cups: number): number {
  return BULK_TIERS.find((t) => cups >= t.minCups && cups <= t.maxCups)?.percent ?? 0;
}
