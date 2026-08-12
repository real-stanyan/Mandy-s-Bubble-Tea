import { describe, it, expect } from "vitest";
import {
  buildPromotionsDigest,
  getLivePromotions,
  nearRewardNudge,
  type CustomerPromoState,
} from "@/lib/chat/promotions";

/** Han, hiragana, katakana, Hangul. */
const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯]/;

const CUSTOMER: CustomerPromoState = {
  starBalance: 7,
  starsPerReward: 9,
  lifetimePoints: 34,
  welcomeAvailable: true,
  igFollowAvailable: true,
  igFollowPercentage: 10,
  flashAvailable: true,
  flashPercentage: 15,
  appDownloadAvailable: true,
  appDownloadPercentage: 20,
};

const CAMPAIGNS = {
  tasting: { available: true, productName: "Mango Pomelo Sago", tastingPriceCents: 550 },
  flash: { available: true, percentage: 15 },
};

/** The system prompt is reference data, and a model cannot tell reference
 *  data from a demonstration of how to sound. Shipping the Chinese card copy
 *  into the prompt made a signed-out customer's English question come back
 *  in Chinese 4 times out of 20, measured against the live catalog on
 *  2026-08-12 — with the customer-facing behaviour otherwise correct, which
 *  is exactly why nobody caught it in review.
 *
 *  This is the gate, not the prompt line asking nicely: card copy stays
 *  Chinese, and anything the model reads stays language-neutral. */
describe("promotion text fed to the model", () => {
  it("carries no CJK for a signed-in customer with every campaign live", async () => {
    const promotions = await getLivePromotions(CUSTOMER, CAMPAIGNS);
    const digest = buildPromotionsDigest(promotions, nearRewardNudge(CUSTOMER));
    expect(digest).not.toMatch(CJK);
  });

  it("carries no CJK for a signed-out stranger", async () => {
    const promotions = await getLivePromotions(null, { tasting: null, flash: null });
    expect(buildPromotionsDigest(promotions, null)).not.toMatch(CJK);
  });

  it("checks every promotion, not just the ones a fixture happens to hit", async () => {
    const promotions = await getLivePromotions(CUSTOMER, CAMPAIGNS);
    // A stranger sees a different loyalty and ig-follow variant, so the two
    // calls together are what covers the branches.
    const stranger = await getLivePromotions(null, { tasting: null, flash: null });
    for (const p of [...promotions, ...stranger]) {
      expect(p.promptDetail, `promptDetail for [${p.key}]`).not.toMatch(CJK);
      expect(p.promptDetail.length, `promptDetail for [${p.key}] is empty`).toBeGreaterThan(0);
    }
  });

  it("keeps the customer-facing card copy in Chinese", async () => {
    const promotions = await getLivePromotions(CUSTOMER, CAMPAIGNS);
    // The point of the split: fixing the prompt must not quietly turn the
    // cards English on a Chinese-speaking customer.
    expect(promotions.every((p) => CJK.test(p.detail))).toBe(true);
  });

  it("keeps the near-reward nudge free of sample sentences", () => {
    const nudge = nearRewardNudge(CUSTOMER);
    expect(nudge).not.toBeNull();
    expect(nudge!).not.toMatch(CJK);
  });
});
