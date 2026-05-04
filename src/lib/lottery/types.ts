// src/lib/lottery/types.ts

export type PrizeType = "thank_you" | "digital" | "physical";

export type PrizeStatus =
  | "won_active"
  | "redeemed"
  | "claimed"
  | "expired"
  | "voided";

export type DigitalPayload =
  | { kind: "discount"; amount_cents: number }
  | { kind: "free_modifier"; modifier_id: string }
  | { kind: "free_drink"; max_cents: number };

export type PhysicalPayload = { label: string };

export type ThankYouPayload = Record<string, never>;

export type PrizePayload = DigitalPayload | PhysicalPayload | ThankYouPayload;

export interface PrizePoolEntry {
  tier_id: string;
  weight: number;
  type: PrizeType;
  payload: PrizePayload;
}

export type PrizePool = PrizePoolEntry[];

export interface RollResult {
  rollId: string;
  tier_id: string;
  prize_type: PrizeType;
  label: string;
  payload: PrizePayload;
  claim_code?: string;
  expires_at: string | null;
}

export interface AppliedPrize {
  rollId: string;
  tier_id: string;
  label: string;
}

export interface Campaign {
  id: string;
  name: string;
  starts_at: string;
  ends_at: string;
  prize_pool: PrizePool;
  is_active: boolean;
}

export const TIER_LABELS: Record<string, string> = {
  thank_you: "Better luck next sip!",
  free_topping: "Free topping",
  discount_3: "$3 off your next order",
  discount_5: "$5 off your next order",
  free_drink: "Free drink of your choice",
  sticker: "Mandy's brand sticker",
};
