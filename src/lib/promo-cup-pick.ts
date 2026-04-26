export interface PickPromoCupsArgs {
  unitPrices: bigint[];
  welcomeK: number;
  igFollowK: number;
}

export interface PickPromoCupsResult {
  welcomeCups: bigint[];
  igFollowCups: bigint[];
}

/**
 * Allocate cups to promotional discounts by sorted unit price.
 *
 * Both welcome and IG-follow take their share from the *cheapest* end
 * of the order — this matches the long-standing welcome behaviour and
 * bounds merchant exposure.
 *
 * Caller contract:
 * - `welcomeK` and `igFollowK` are the *attempted* K values, derived
 *   per-promo from server-side ticket status. Pass `0` when a promo is
 *   unavailable. This helper does not look up status.
 * - One-cup-with-welcome-priority rule: when there is exactly one cup
 *   and both promos want a slice, welcome wins (more savings to user)
 *   and IG ticket is preserved. The caller must therefore NOT call
 *   `consumeIgFollowDiscount` when `igFollowCups.length === 0`.
 */
export function pickPromoCups(args: PickPromoCupsArgs): PickPromoCupsResult {
  const sorted = [...args.unitPrices].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );

  if (
    sorted.length === 1 &&
    args.welcomeK >= 1 &&
    args.igFollowK >= 1
  ) {
    return { welcomeCups: [sorted[0]], igFollowCups: [] };
  }

  const welcomeTake = Math.min(Math.max(0, args.welcomeK), sorted.length);
  const igTake = Math.min(
    Math.max(0, args.igFollowK),
    Math.max(0, sorted.length - welcomeTake),
  );

  return {
    welcomeCups: sorted.slice(0, welcomeTake),
    igFollowCups: sorted.slice(welcomeTake, welcomeTake + igTake),
  };
}
