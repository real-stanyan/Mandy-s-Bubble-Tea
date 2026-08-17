import { describe, it, expect } from "vitest";
import { nearRewardNudge, buildPromotionsDigest } from "./promotions";
import type { CustomerPromoState } from "./promotions";

function customer(starBalance: number, starsPerReward = 9): CustomerPromoState {
  return {
    starBalance,
    starsPerReward,
    lifetimePoints: starBalance,
    mysteryCouponLabels: [],
    welcomeAvailable: false,
    igFollowAvailable: false,
    igFollowPercentage: 0,
    flashAvailable: false,
    flashPercentage: 0,
    appDownloadAvailable: false,
    appDownloadPercentage: 0,
  };
}

describe("nearRewardNudge", () => {
  it("fires at one and two stars away", () => {
    // 61.9% of orders in the last 90 days were a single drink. Telling
    // someone who is one cup from a free drink is the cheapest honest way
    // to move that — it is information they want, not a pitch.
    expect(nearRewardNudge(customer(8))).toContain("1 star");
    expect(nearRewardNudge(customer(7))).toContain("2 stars");
  });

  it("stays quiet when the reward is still far off", () => {
    // At three or more it stops being news and starts being pressure.
    for (const b of [0, 1, 5, 6]) {
      expect(nearRewardNudge(customer(b)), `balance ${b}`).toBeNull();
    }
  });

  it("stays quiet when a reward is already earned, not approaching", () => {
    // 9 stars means they HAVE one — the loyalty card says so; nudging
    // "one more cup" would be wrong.
    expect(nearRewardNudge(customer(9))).toBeNull();
    expect(nearRewardNudge(customer(18))).toBeNull();
  });

  it("counts within the current cycle, not from zero", () => {
    // 17 of 18 → one away from the second reward.
    expect(nearRewardNudge(customer(17))).toContain("1 star");
  });

  it("says nothing about a customer we can't identify", () => {
    expect(nearRewardNudge(null)).toBeNull();
  });

  it("tells the model to mention it once, not to sell", () => {
    const n = nearRewardNudge(customer(8))!;
    expect(n).toMatch(/ONCE/);
    expect(n).toMatch(/never repeat/i);
  });

  it("rides in the digest only when present", () => {
    const promos = [
      {
        key: "loyalty" as const,
        title: "t",
        detail: "d",
        promptDetail: "p",
        href: null,
        cta: null,
      },
    ];
    expect(buildPromotionsDigest(promos, null)).not.toContain("NEARLY THERE");
    expect(buildPromotionsDigest(promos, nearRewardNudge(customer(8)))).toContain("NEARLY THERE");
  });
});
