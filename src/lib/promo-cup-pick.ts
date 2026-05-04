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
 * Welcome and IG-follow are mutually exclusive at the order level:
 * when both promos are available the order uses welcome only and the
 * IG ticket is preserved for a future order. The chosen promo takes
 * its share from the *cheapest* end of the order, which matches the
 * long-standing welcome behaviour and bounds merchant exposure.
 *
 * Caller contract:
 * - `welcomeK` and `igFollowK` are the *attempted* K values, derived
 *   per-promo from server-side ticket status. Pass `0` when a promo is
 *   unavailable. This helper does not look up status.
 * - Welcome wins when both are available; the caller must therefore NOT
 *   call `consumeIgFollowDiscount` when `igFollowCups.length === 0`.
 */
export function pickPromoCups(args: PickPromoCupsArgs): PickPromoCupsResult {
  const sorted = [...args.unitPrices].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );

  if (args.welcomeK >= 1) {
    const welcomeTake = Math.min(args.welcomeK, sorted.length);
    return {
      welcomeCups: sorted.slice(0, welcomeTake),
      igFollowCups: [],
    };
  }

  if (args.igFollowK >= 1) {
    const igTake = Math.min(args.igFollowK, sorted.length);
    return {
      welcomeCups: [],
      igFollowCups: sorted.slice(0, igTake),
    };
  }

  return { welcomeCups: [], igFollowCups: [] };
}
