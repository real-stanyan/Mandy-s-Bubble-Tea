// src/lib/tier-checkout-preview.ts
import { TIER_DISCOUNT_PERCENT, type MembershipTier } from "@/lib/membership-tier";
import {
  collectPaidToppingUnits,
  coverFreeToppings,
  type CupRecord,
} from "@/lib/tier-toppings";

/**
 * Client-side preview of the server's tier discount math (orders route is
 * authoritative; this mirrors it so the displayed total equals the charge).
 */
export function tierCheckoutPreview(args: {
  tier: MembershipTier;
  cups: CupRecord[];
  rewardCount: number;
  toppingsRemaining: number;
  subtotal: bigint;
  rewardDiscount: bigint;
  welcomeDiscount: bigint;
  igFollowDiscount: bigint;
}): { tierDiscountCents: bigint; toppingCoveredCents: bigint; toppingCoveredCount: number } {
  if (args.tier === "silver") {
    return { tierDiscountCents: 0n, toppingCoveredCents: 0n, toppingCoveredCount: 0 };
  }
  let toppingCoveredCents = 0n;
  let toppingCoveredCount = 0;
  if (args.tier === "diamond") {
    const pool = collectPaidToppingUnits(args.cups, args.rewardCount);
    const cover = coverFreeToppings(pool, args.toppingsRemaining);
    toppingCoveredCents = cover.amount;
    toppingCoveredCount = cover.coveredCount;
  }
  let base =
    args.subtotal -
    args.rewardDiscount -
    args.welcomeDiscount -
    args.igFollowDiscount -
    toppingCoveredCents;
  if (base < 0n) base = 0n;
  return {
    tierDiscountCents: (base * BigInt(TIER_DISCOUNT_PERCENT)) / 100n,
    toppingCoveredCents,
    toppingCoveredCount,
  };
}
