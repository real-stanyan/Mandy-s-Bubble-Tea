import "server-only";
import { randomUUID } from "crypto";
import { squareClient, SQUARE_LOCATION_ID } from "@/lib/square";

// Thin helpers around the Square Loyalty API. Squared away in one
// place so API routes don't re-fetch the active program on every call
// and don't repeat the "search then create" dance for accounts.

// A Square seller can only have a single active loyalty program. The
// SDK accepts the literal "main" as a sentinel that resolves to that
// program — handy because it saves us from caching a program id that
// rarely changes anyway.
const MAIN_PROGRAM_ID = "main";

let cachedProgramId: string | null = null;
let cachedStarsPerReward: number | null = null;
let cachedRewardTierId: string | null = null;

/**
 * Force the next call to getActiveProgram() to re-fetch from Square.
 * Call this after a Square error that implies our cached tier id has
 * gone stale (e.g. NOT_FOUND on reward_tier_id after the seller
 * rebuilt their rewards in the Dashboard).
 */
export function invalidateLoyaltyProgramCache(): void {
  cachedProgramId = null;
  cachedStarsPerReward = null;
  cachedRewardTierId = null;
}

type LoyaltyProgramInfo = {
  programId: string;
   /**
    * Points the seller has configured as the default reward tier —
    * used by the UI as "stars needed for a free drink". Falls back to
    * the constant in src/lib/constants.ts if no reward tiers exist.
    */
  starsPerReward: number;
   /** The reward tier id for the smallest reward (one free drink). */
  rewardTierId: string;
};

/**
 * Fetch the seller's active loyalty program. Cached in module scope
 * for the lifetime of the server process — program config changes are
 * extremely rare and a cold reload picks them up.
 */
export async function getActiveProgram(): Promise<LoyaltyProgramInfo> {
  if (cachedProgramId && cachedStarsPerReward != null && cachedRewardTierId) {
    return {
      programId: cachedProgramId,
      starsPerReward: cachedStarsPerReward,
      rewardTierId: cachedRewardTierId,
     };
    }

  const response = await squareClient.loyalty.programs.get({
    programId: MAIN_PROGRAM_ID,
   });
  const program = response.program;
  if (!program?.id) {
    throw new Error("No active loyalty program found on this Square account");
   }

   // The smallest reward tier is what we treat as "one free drink".
   // We coerce `points` through Number() because the Square SDK has
   // historically returned numeric fields as bigint at runtime even
   // when the declared type is `number` — a plain `typeof === "number"`
   // filter would silently drop every tier and fall back to a bogus
   // reward tier id. An empty/invalid tier list is a hard error: the
   // previous "default" fallback meant Square rejected redemptions
   // with reward_tier_id NOT_FOUND instead of a clear message.
   const tiers: Array<{ points: number; id: string }> = [];
   for (const t of program.rewardTiers ?? []) {
     const points = Number(
       (t as { points?: unknown }).points as number | bigint | string,
     );
     const id = (t as { id?: unknown }).id;
     if (
       Number.isFinite(points) &&
       typeof id === "string" &&
       id.length > 0
     ) {
       tiers.push({ points, id });
     }
   }
   if (tiers.length === 0) {
     throw new Error(
       `Loyalty program "${program.id}" has no reward tiers configured. Add one in Square Dashboard → Loyalty → Rewards before using redemption.`,
     );
   }
   const minTier = tiers.reduce((min, t) =>
     t.points < min.points ? t : min,
   );

  cachedProgramId = program.id;
   cachedStarsPerReward = minTier.points;
   cachedRewardTierId = minTier.id;

  return {
    programId: cachedProgramId,
    starsPerReward: cachedStarsPerReward,
    rewardTierId: cachedRewardTierId,
   };
}

type LoyaltyAccountSummary = {
  accountId: string;
  balance: number;
  lifetimePoints: number;
};

/**
 * Look up the loyalty account for a phone number without creating
 * one. Use this in read/redeem flows where conjuring a zero-balance
 * account on a lookup miss would be wrong (e.g. redemption silently
 * treating the user as a brand-new customer with 0 stars).
 *
 * Returns `null` when no account is mapped to the phone.
 */
export async function findLoyaltyAccountByPhone(
  phoneE164: string,
): Promise<LoyaltyAccountSummary | null> {
  const search = await squareClient.loyalty.accounts.search({
    query: {
      mappings: [{ phoneNumber: phoneE164 }],
    },
    limit: 1,
  });

  const existing = search.loyaltyAccounts?.[0];
  if (!existing?.id) return null;

  return {
    accountId: existing.id,
    balance: existing.balance ?? 0,
    lifetimePoints: existing.lifetimePoints ?? 0,
  };
}

/**
 * Look up the loyalty account for a customer by their phone number,
 * or create one if missing. Phone is the canonical mapping key for
 * loyalty accounts — `customerId` alone isn't searchable.
 */
export async function findOrCreateLoyaltyAccount(
  customerId: string,
  phoneE164: string,
): Promise<LoyaltyAccountSummary> {
  const { programId } = await getActiveProgram();

   // Search by phone first. Square's loyalty search query is phone-
   // based; there's no customerId-based lookup endpoint.
  const search = await squareClient.loyalty.accounts.search({
    query: {
      mappings: [{ phoneNumber: phoneE164 }],
      },
    limit: 1,
   });

  const existing = search.loyaltyAccounts?.[0];
  if (existing?.id) {
    return {
      accountId: existing.id,
      balance: existing.balance ?? 0,
      lifetimePoints: existing.lifetimePoints ?? 0,
      };
    }

   // Not found — enroll the buyer.
  const created = await squareClient.loyalty.accounts.create({
    idempotencyKey: randomUUID(),
    loyaltyAccount: {
      programId,
      customerId,
      mapping: { phoneNumber: phoneE164 },
      },
   });

  const account = created.loyaltyAccount;
  if (!account?.id) {
    throw new Error("Square did not return a loyalty account id");
   }

  return {
    accountId: account.id,
    balance: account.balance ?? 0,
    lifetimePoints: account.lifetimePoints ?? 0,
   };
}

/**
 * Accumulate points for a paid order. Square computes how many points
 * the order earns based on the program's accrual rules — we just
 * point at the orderId and it figures the rest out.
 *
 * Intentionally throws on error so callers can decide whether to
 * swallow (e.g. during checkout, loyalty failure should not fail the
 * payment) or surface to the user.
 */
export async function accrueForOrder(
  accountId: string,
  orderId: string,
): Promise<void> {
  if (!SQUARE_LOCATION_ID) {
    throw new Error("SQUARE_LOCATION_ID is not set");
   }

  await squareClient.loyalty.accounts.accumulatePoints({
    accountId,
    idempotencyKey: randomUUID(),
    locationId: SQUARE_LOCATION_ID,
    accumulatePoints: {
      orderId,
      },
   });
}

/**
 * Redeem a loyalty reward for a customer. Creates a loyalty reward
 * that can be attached to an order via the loyaltyRewardId.
 *
 * Returns the loyaltyRewardId which must be attached to the order
 * in the orders.create call.
 *
 * The Square Create Loyalty Reward endpoint does NOT accept a
 * `status` field in the request body — rewards are always created
 * in the ISSUED state. Including it in earlier versions of this
 * code was harmless with some SDK releases but has tripped up others.
 * We omit it now so the request matches the API schema exactly.
 */
export async function redeemReward(
  accountId: string,
  rewardTierId: string,
  orderId?: string,
): Promise<{ loyaltyRewardId: string }> {
  try {
    const result = await squareClient.loyalty.rewards.create({
      idempotencyKey: randomUUID(),
      reward: {
        loyaltyAccountId: accountId,
        rewardTierId,
        // When orderId is provided, Square automatically applies the
        // reward's discount to that order. This is the ONLY supported
        // way to discount an order with a loyalty reward — there is
        // no loyaltyRewards field on the order-create request body.
        ...(orderId ? { orderId } : {}),
      },
    });

    const rewardId = result.reward?.id;
    if (!rewardId) {
      throw new Error("Square did not return a loyalty reward id");
    }

    return { loyaltyRewardId: rewardId };
  } catch (err) {
    // Invalidate the cached program so the next attempt refetches —
    // if the seller rebuilt their reward tiers in the Dashboard our
    // cached id is permanently stale until a process restart. Then
    // re-throw with the values we actually sent so the API route
    // response is actionable instead of an opaque Square dump.
    invalidateLoyaltyProgramCache();
    const base = err instanceof Error ? err.message : String(err);
    const wrapped = new Error(
      `Square rejected loyalty reward create (accountId=${accountId}, rewardTierId=${rewardTierId}): ${base}`,
    );
    (wrapped as Error & { cause?: unknown }).cause = err;
    throw wrapped;
  }
}
