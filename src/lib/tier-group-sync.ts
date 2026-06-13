// src/lib/tier-group-sync.ts
// Projects derived membership tier (lib/membership-tier) into Square customer
// groups so the POS pricing rule "Tier member 5% off" auto-applies in-store.
// NOTE: relative import + no "@/lib/square" import — this module is shared
// with tsx ops scripts (scripts/backfill-tier-groups.ts) which cannot resolve
// the "@" alias and must not pull in "server-only".
import { tierFor } from "./membership-tier";

export type TierGroupIds = { gold: string; diamond: string };
export type GroupPlan = { add: string[]; remove: string[] };

export function tierGroupIdsFromEnv(): TierGroupIds | null {
  const gold = process.env.SQUARE_TIER_GROUP_GOLD_ID;
  const diamond = process.env.SQUARE_TIER_GROUP_DIAMOND_ID;
  if (!gold || !diamond) return null;
  return { gold, diamond };
}

/**
 * Pure plan: which tier groups to add/remove for a customer, given lifetime
 * points and the customer's current Square group ids. Idempotent — returns
 * empty arrays when membership already matches the derived tier. Non-tier
 * groups are never touched.
 */
export function tierGroupPlan(
  lifetimePoints: number,
  currentGroupIds: readonly string[],
  ids: TierGroupIds,
): GroupPlan {
  const tier = tierFor(lifetimePoints);
  const want =
    tier === "diamond" ? ids.diamond : tier === "gold" ? ids.gold : null;
  const tierGroups = [ids.gold, ids.diamond];
  const current = currentGroupIds.filter((g) => tierGroups.includes(g));
  return {
    add: want && !current.includes(want) ? [want] : [],
    remove: current.filter((g) => g !== want),
  };
}

/**
 * Minimal structural slice of SquareClient used by the sync — lets vitest
 * inject a plain object and lets tsx scripts pass their own SquareClient
 * without this module importing "@/lib/square" (which is server-only).
 */
export type TierGroupClient = {
  customers: {
    get(req: {
      customerId: string;
    }): Promise<{ customer?: { groupIds?: string[] | null } | null }>;
    groups: {
      add(req: { customerId: string; groupId: string }): Promise<unknown>;
      remove(req: { customerId: string; groupId: string }): Promise<unknown>;
    };
  };
};

/** Fetch current groups, plan, execute. Throws on Square errors — callers log. */
export async function syncTierGroups(
  client: TierGroupClient,
  customerId: string,
  lifetimePoints: number,
  ids: TierGroupIds,
): Promise<GroupPlan> {
  const res = await client.customers.get({ customerId });
  const plan = tierGroupPlan(lifetimePoints, res.customer?.groupIds ?? [], ids);
  for (const groupId of plan.add) {
    await client.customers.groups.add({ customerId, groupId });
  }
  for (const groupId of plan.remove) {
    await client.customers.groups.remove({ customerId, groupId });
  }
  return plan;
}
