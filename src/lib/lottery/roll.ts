import { generateUniqueClaimCode } from "./claim-code";
import { rollWeighted, defaultRandom, type RandomFn } from "./random";
import type { Campaign, PrizePool, RollResult } from "./types";
import { TIER_LABELS } from "./types";

export type OrderSource = "app" | "web";

export interface RollInput {
  userId: string;
  squareOrderId: string;
  source: OrderSource;
}

export interface RollDeps {
  getActiveCampaign(): Promise<Campaign | null>;
  userHasPhysicalLock(userId: string, campaignId: string): Promise<boolean>;
  insertRoll(row: {
    campaign_id: string;
    user_id: string;
    square_order_id: string;
    tier_id: string;
    prize_type: "thank_you" | "digital" | "physical";
    prize_payload: object;
    expires_at: string | null;
    claim_code: string | null;
    status: string;
  }): Promise<{ id: string }>;
  claimCodeExists(code: string): Promise<boolean>;
  rng?: RandomFn;
}

const MS_PER_DAY = 86_400_000;

function maskPhysical(pool: PrizePool): PrizePool {
  return pool.filter((e) => e.type !== "physical");
}

export async function rollPrize(
  input: RollInput,
  deps: RollDeps,
): Promise<RollResult | null> {
  if (input.source !== "app") return null;

  const campaign = await deps.getActiveCampaign();
  if (!campaign) return null;

  const hasLock = await deps.userHasPhysicalLock(input.userId, campaign.id);
  const pool = hasLock ? maskPhysical(campaign.prize_pool) : campaign.prize_pool;
  if (pool.length === 0) return null;

  const rng = deps.rng ?? defaultRandom;
  const winner = rollWeighted(pool, rng);

  const now = Date.now();
  const expiresAt: string | null =
    winner.type === "digital"
      ? new Date(now + 30 * MS_PER_DAY).toISOString()
      : winner.type === "physical"
      ? new Date(now + 7 * MS_PER_DAY).toISOString()
      : null;

  const claimCode =
    winner.type === "physical"
      ? await generateUniqueClaimCode(deps.claimCodeExists)
      : null;

  const inserted = await deps.insertRoll({
    campaign_id: campaign.id,
    user_id: input.userId,
    square_order_id: input.squareOrderId,
    tier_id: winner.tier_id,
    prize_type: winner.type,
    prize_payload: winner.payload as object,
    expires_at: expiresAt,
    claim_code: claimCode,
    status: "won_active",
  });

  return {
    rollId: inserted.id,
    tier_id: winner.tier_id,
    prize_type: winner.type,
    label: TIER_LABELS[winner.tier_id] ?? winner.tier_id,
    payload: winner.payload,
    claim_code: claimCode ?? undefined,
    expires_at: expiresAt,
  };
}
