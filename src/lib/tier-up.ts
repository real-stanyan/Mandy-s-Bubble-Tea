// src/lib/tier-up.ts
import type { MembershipTier } from "@/lib/membership-tier";

const RANK: Record<MembershipTier, number> = { silver: 0, gold: 1, diamond: 2 };

/** localStorage key remembering the last tier this device saw. */
export const LAST_TIER_STORAGE_KEY = "mandy_last_tier";

/**
 * Celebrate only on a genuine upgrade vs the last tier this device saw.
 * `prev` is raw localStorage content: null (first visit) or garbage never
 * celebrates — first visit just stores the current tier.
 */
export function shouldCelebrate(prev: string | null, next: MembershipTier): boolean {
  if (prev !== "silver" && prev !== "gold" && prev !== "diamond") return false;
  return RANK[next] > RANK[prev as MembershipTier];
}
