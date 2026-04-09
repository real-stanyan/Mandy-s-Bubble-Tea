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

  cachedProgramId = program.id;
   // The smallest reward tier is what we treat as "one free drink".
   // Ignore ineligible tiers by picking the min points across tiers.
  const rawTiers = program.rewardTiers as any[] | undefined;
  const tiers = rawTiers?.filter(
     (t) => typeof t.points === "number" && t.id != null,
   ) as Array<{ points: number; id: string }> | undefined;
  if (tiers && tiers.length > 0) {
    const minTier = tiers.reduce((min, t) =>
      t.points < min.points ? t : min,
      );
    cachedStarsPerReward = minTier.points;
    cachedRewardTierId = minTier.id ?? "default";
   } else {
    cachedStarsPerReward = 9;
    cachedRewardTierId = "default";
   }

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
 */
export async function redeemReward(
  accountId: string,
  rewardTierId: string,
): Promise<{ loyaltyRewardId: string }> {
  const result = await squareClient.loyalty.rewards.create({
    idempotencyKey: randomUUID(),
    reward: {
      loyaltyAccountId: accountId,
      rewardTierId,
      status: "ISSUED",
      },
   });

  const rewardId = result.reward?.id;
  if (!rewardId) {
    throw new Error("Square did not return a loyalty reward id");
   }

  return { loyaltyRewardId: rewardId };
}
