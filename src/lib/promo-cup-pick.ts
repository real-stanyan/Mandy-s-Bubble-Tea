export interface PickPromoCupsArgs {
  unitPrices: bigint[];
  welcomeK: number;
  igFollowK: number;
  loyaltyRewardCount?: number;
}

export interface PickPromoCupsResult {
  loyaltyRewardCups: bigint[];
  welcomeCups: bigint[];
  igFollowCups: bigint[];
}

/**
 * Allocate cups to loyalty rewards and promotional discounts, sorted by
 * unit price (cheapest first).
 *
 * Allocation order:
 *  1. Loyalty rewards eat the cheapest `loyaltyRewardCount` cups (clamped
 *     to available cup count).
 *  2. From the remaining cups, welcome takes its share if welcomeK >= 1.
 *  3. Otherwise IG-follow takes its share if igFollowK >= 1.
 *
 * Welcome and IG-follow remain mutually exclusive at the order level:
 * when both are available the order uses welcome only and the IG ticket
 * is preserved. The chosen promo takes its share from the *cheapest* end
 * of the remaining cups.
 *
 * Caller contract:
 * - `loyaltyRewardCount` is the number of reward redemptions client wants
 *   to apply. Defaults to 0. Caller is responsible for capping it to
 *   `min(floor(stars/starsPerReward), cupCount)`.
 * - `welcomeK` and `igFollowK` are the *attempted* K values, derived
 *   per-promo from server-side ticket status. Pass `0` when a promo is
 *   unavailable. Welcome wins when both are available; the caller must
 *   therefore NOT call `consumeIgFollowDiscount` when
 *   `igFollowCups.length === 0`.
 */
export function pickPromoCups(args: PickPromoCupsArgs): PickPromoCupsResult {
  const sorted = [...args.unitPrices].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );

  const rewardTake = Math.min(
    Math.max(0, args.loyaltyRewardCount ?? 0),
    sorted.length,
  );
  const loyaltyRewardCups = sorted.slice(0, rewardTake);
  const remaining = sorted.slice(rewardTake);

  if (args.welcomeK >= 1) {
    const welcomeTake = Math.min(args.welcomeK, remaining.length);
    return {
      loyaltyRewardCups,
      welcomeCups: remaining.slice(0, welcomeTake),
      igFollowCups: [],
    };
  }

  if (args.igFollowK >= 1) {
    const igTake = Math.min(args.igFollowK, remaining.length);
    return {
      loyaltyRewardCups,
      welcomeCups: [],
      igFollowCups: remaining.slice(0, igTake),
    };
  }

  return { loyaltyRewardCups, welcomeCups: [], igFollowCups: [] };
}
