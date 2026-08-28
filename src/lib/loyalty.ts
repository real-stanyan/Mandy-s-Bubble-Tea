import "server-only";
import { randomUUID } from "crypto";
import {
  squareClient,
  SQUARE_LOCATION_ID,
  findCustomerByPhone,
} from "@/lib/square";

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
 *
 * Falls back to a customer-lookup + customerIds search when the phone
 * mapping lookup misses: POS-created loyalty accounts sometimes have a
 * differently-formatted (or missing) phone mapping even though they're
 * correctly linked to the Square Customer record.
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
  if (existing?.id) {
    return {
      accountId: existing.id,
      balance: Number(existing.balance ?? 0),
      lifetimePoints: Number(existing.lifetimePoints ?? 0),
    };
  }

  const customer = await findCustomerByPhone(phoneE164);
  if (!customer?.id) return null;

  const byCustomer = await squareClient.loyalty.accounts.search({
    query: { customerIds: [customer.id] },
    limit: 1,
  });
  const found = byCustomer.loyaltyAccounts?.[0];
  if (!found?.id) return null;

  return {
    accountId: found.id,
    balance: Number(found.balance ?? 0),
    lifetimePoints: Number(found.lifetimePoints ?? 0),
  };
}

/**
 * Look up the loyalty account for a customer by their phone number,
 * or create one if missing.
 *
 * Historically the phone mapping was the first-class key, but POS-
 * created accounts sometimes carry a stale or missing phone mapping
 * while still being correctly linked to the Square customer by id.
 * If we went straight to create on a phone miss, Square would happily
 * create a second, empty account for a loyalty-account-less customer
 * even when a legitimate account was floating with a bad mapping — so
 * we now try both identity axes (phone mapping + customerId) first and
 * only fall through to create when neither turns anything up.
 */
export async function findOrCreateLoyaltyAccount(
  customerId: string,
  phoneE164: string,
): Promise<LoyaltyAccountSummary> {
  const { programId } = await getActiveProgram();

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
      balance: Number(existing.balance ?? 0),
      lifetimePoints: Number(existing.lifetimePoints ?? 0),
    };
  }

  // Phone miss — check whether the customer already owns a loyalty
  // account via a different (or missing) phone mapping. Doing this
  // BEFORE create is what prevents orphaned-mapping accounts from
  // silently being duplicated into fresh zero-balance ones.
  const byCustomer = await squareClient.loyalty.accounts.search({
    query: { customerIds: [customerId] },
    limit: 1,
  });
  const owned = byCustomer.loyaltyAccounts?.[0];
  if (owned?.id) {
    return {
      accountId: owned.id,
      balance: Number(owned.balance ?? 0),
      lifetimePoints: Number(owned.lifetimePoints ?? 0),
    };
  }

  // Neither the phone nor the customerId found an account — safe to
  // create. The catch block is still required: if another concurrent
  // request created the account in between our search and create call,
  // Square throws "already has a loyalty account" and we fall back to
  // the customerIds search one more time.
  try {
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
      balance: Number(account.balance ?? 0),
      lifetimePoints: Number(account.lifetimePoints ?? 0),
    };
  } catch (createErr) {
    const msg = createErr instanceof Error ? createErr.message : String(createErr);
    if (!msg.includes("already has a loyalty account")) throw createErr;

    const fallback = await squareClient.loyalty.accounts.search({
      query: { customerIds: [customerId] },
      limit: 1,
    });

    const found = fallback.loyaltyAccounts?.[0];
    if (!found?.id) {
      throw new Error(
        "Customer already has a loyalty account but it could not be retrieved",
      );
    }

    return {
      accountId: found.id,
      balance: Number(found.balance ?? 0),
      lifetimePoints: Number(found.lifetimePoints ?? 0),
    };
  }
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
  idempotencyKey?: string,
): Promise<void> {
  if (!SQUARE_LOCATION_ID) {
    throw new Error("SQUARE_LOCATION_ID is not set");
  }

  await squareClient.loyalty.accounts.accumulatePoints({
    accountId,
    idempotencyKey: idempotencyKey ?? randomUUID(),
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

/**
 * Reverse the loyalty stars previously accrued for an order. Called
 * from the Square webhook on refund.created/refund.updated COMPLETED.
 * Idempotent: the idempotencyKey is derived from refundId so Square
 * dedupes a duplicate call (e.g. Square re-delivers the webhook).
 *
 * Returns the count of stars reversed and the loyalty account id, or
 * `{reversed: 0, accountId: null}` if the order had no accrual events
 * (e.g. POS order with no enrolled customer, or already-reversed).
 */
export async function reverseAccrualForOrder(
  orderId: string,
  refundId: string,
): Promise<{ reversed: number; accountId: string | null }> {
  const response = await squareClient.loyalty.searchEvents({
    query: {
      filter: {
        orderFilter: { orderId },
        typeFilter: { types: ["ACCUMULATE_POINTS"] },
      },
    },
    limit: 30,
  });

  const events = response.events ?? [];
  let totalPoints = 0;
  let accountId: string | null = null;
  for (const e of events) {
    const pts = Number(e.accumulatePoints?.points ?? 0);
    if (Number.isFinite(pts) && pts > 0) {
      totalPoints += pts;
      if (!accountId && e.loyaltyAccountId) accountId = e.loyaltyAccountId;
    }
  }

  if (totalPoints === 0 || !accountId) {
    return { reversed: 0, accountId };
  }

  await squareClient.loyalty.accounts.adjust({
    accountId,
    idempotencyKey: `refund-reverse-${refundId}`,
    adjustPoints: {
      points: -totalPoints,
      reason: `Refund reversal for refund ${refundId}`,
    },
  });

  return { reversed: totalPoints, accountId };
}

/**
 * Return the stars a customer SPENT on rewards for an order, on full refund.
 * Counterpart to reverseAccrualForOrder (which claws back stars earned): here
 * we credit back stars redeemed. Used when an order that was already paid gets
 * refunded — its rewards are in REDEEMED state and can't be deleted (unlike the
 * pre-payment path, see returnOrderRewards), so we credit the points directly.
 *
 * Each REDEEM_REWARD event on the order is one reward, costing the program's
 * starsPerReward (this seller runs a single reward tier). Idempotent: the
 * idempotencyKey is derived from refundId so a re-delivered webhook is deduped
 * by Square. Returns `{returned: 0, accountId: null}` when the order redeemed
 * no rewards (the common case).
 */
export async function returnRedeemedStarsForOrder(
  orderId: string,
  refundId: string,
): Promise<{ returned: number; accountId: string | null }> {
  const response = await squareClient.loyalty.searchEvents({
    query: {
      filter: {
        orderFilter: { orderId },
        typeFilter: { types: ["REDEEM_REWARD"] },
      },
    },
    limit: 30,
  });

  const events = response.events ?? [];
  let accountId: string | null = null;
  for (const e of events) {
    if (e.loyaltyAccountId) {
      accountId = e.loyaltyAccountId;
      break;
    }
  }

  if (events.length === 0 || !accountId) {
    return { returned: 0, accountId };
  }

  const { starsPerReward } = await getActiveProgram();
  const points = events.length * starsPerReward;

  await squareClient.loyalty.accounts.adjust({
    accountId,
    idempotencyKey: `refund-redeem-return-${refundId}`,
    adjustPoints: {
      points,
      reason: `Reward star return for refund ${refundId}`,
    },
  });

  return { returned: points, accountId };
}

/**
 * Return the loyalty rewards (stars) a customer spent on an order, by deleting
 * each reward attached to it. Deleting an ISSUED reward returns its points to
 * the account and strips the reward's discount line from the order (same call
 * the redeem route uses for rollback) — so a customer never loses stars on an
 * order that gets released before it's accepted (Mandy Delivery auto-cancel).
 *
 * The reward ids come from `order.rewards`. The delete is version-free (it
 * targets the reward, not the order), but it DOES bump the order's version —
 * callers that update the order afterwards must re-fetch first.
 *
 * Idempotent and best-effort: a reward already deleted (or REDEEMED once the
 * order was paid — which shouldn't happen for an unaccepted order) throws, so
 * we swallow per-reward errors and keep going rather than block the cancel.
 */
export async function returnOrderRewards(order: {
  id?: string;
  rewards?: { id?: string }[] | null;
}): Promise<{ returned: number }> {
  const rewards = order.rewards ?? [];
  let returned = 0;
  for (const reward of rewards) {
    if (!reward.id) continue;
    try {
      await squareClient.loyalty.rewards.delete({ rewardId: reward.id });
      returned += 1;
    } catch (err) {
      console.error(
        `[returnOrderRewards] order=${order.id} reward=${reward.id} delete failed:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return { returned };
}

/**
 * Release ISSUED rewards stranded on dead orders, returning their held
 * stars to the account.
 *
 * The leak this closes (2026-08-28, in-store): redeem 2 rewards → card
 * declined → customer starts a fresh cart → the 18 held stars are still
 * pinned to the abandoned order, the new redeem sees balance 6 and says
 * "Not enough stars" to a customer whose app shows 24. Nothing ever
 * released the holds.
 *
 * A reward is reclaimed only when its attached order is genuinely dead:
 * CANCELED, or still unpaid (netAmountDue > 0) with no live card tender —
 * an AUTHORIZED hold (Mandy Delivery pre-accept) or CAPTURED tender means
 * the order is real and keeps its rewards. `excludeOrderId` protects the
 * checkout being processed right now; `minAgeMs` lets the cron sweep keep
 * clear of just-created checkouts it can't see the client side of.
 *
 * Best-effort by design: any per-reward failure (lookup or delete) skips
 * that reward — a reclaim pass must never take down the caller.
 */
export async function reclaimStrandedRewards(
  accountId: string,
  opts: { excludeOrderId?: string; minAgeMs?: number } = {},
): Promise<{ reclaimed: number }> {
  const minAgeMs = opts.minAgeMs ?? 0;
  let reclaimed = 0;
  try {
    const res = await squareClient.loyalty.rewards.search({
      query: { loyaltyAccountId: accountId },
      limit: 30,
    });
    for (const reward of res.rewards ?? []) {
      if (reward.status !== "ISSUED" || !reward.id) continue;
      if (!reward.orderId) continue;
      if (opts.excludeOrderId && reward.orderId === opts.excludeOrderId) continue;
      if (reward.createdAt) {
        const age = Date.now() - Date.parse(reward.createdAt);
        if (Number.isFinite(age) && age < minAgeMs) continue;
      }
      try {
        const { order } = await squareClient.orders.get({ orderId: reward.orderId });
        if (!order) continue;
        const total = order.totalMoney?.amount ?? 0n;
        const due = order.netAmountDueMoney?.amount ?? total;
        const liveTender = (order.tenders ?? []).some((t) => {
          const s = t.cardDetails?.status;
          return s === "AUTHORIZED" || s === "CAPTURED" || t.type === "CASH";
        });
        const dead =
          order.state === "CANCELED" || (due > 0n && !liveTender);
        if (!dead) continue;
        await squareClient.loyalty.rewards.delete({ rewardId: reward.id });
        reclaimed += 1;
        console.log(
          `[reclaimStrandedRewards] account=${accountId} released reward=${reward.id} from dead order=${reward.orderId}`,
        );
      } catch (err) {
        console.error(
          `[reclaimStrandedRewards] reward=${reward.id} skipped:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  } catch (err) {
    console.error(
      `[reclaimStrandedRewards] account=${accountId} search failed:`,
      err instanceof Error ? err.message : String(err),
    );
  }
  return { reclaimed };
}
