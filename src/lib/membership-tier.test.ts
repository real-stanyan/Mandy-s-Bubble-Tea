// src/lib/membership-tier.test.ts
import { describe, expect, it } from "vitest";
import {
  DIAMOND_MONTHLY_FREE_TOPPINGS,
  TIER_DISCOUNT_PERCENT,
  TIER_THRESHOLDS,
  brisbaneMonthKey,
  tierFor,
  tierProgress,
} from "@/lib/membership-tier";

describe("tierFor", () => {
  it("maps lifetime points to tiers at exact boundaries", () => {
    expect(tierFor(0)).toBe("silver");
    expect(tierFor(29)).toBe("silver");
    expect(tierFor(30)).toBe("gold");
    expect(tierFor(79)).toBe("gold");
    expect(tierFor(80)).toBe("diamond");
    expect(tierFor(500)).toBe("diamond");
  });

  it("treats negative/NaN as silver", () => {
    expect(tierFor(-5)).toBe("silver");
    expect(tierFor(Number.NaN)).toBe("silver");
  });
});

describe("tierProgress", () => {
  it("silver progresses toward gold", () => {
    expect(tierProgress(23)).toEqual({ tier: "silver", nextTier: "gold", starsToNext: 7 });
  });
  it("gold progresses toward diamond", () => {
    expect(tierProgress(30)).toEqual({ tier: "gold", nextTier: "diamond", starsToNext: 50 });
    expect(tierProgress(79)).toEqual({ tier: "gold", nextTier: "diamond", starsToNext: 1 });
  });
  it("diamond is terminal", () => {
    expect(tierProgress(80)).toEqual({ tier: "diamond", nextTier: null, starsToNext: null });
  });
});

describe("brisbaneMonthKey", () => {
  it("uses fixed UTC+10 (Brisbane, no DST)", () => {
    expect(brisbaneMonthKey(new Date("2026-06-30T15:00:00Z"))).toBe("2026-07");
    expect(brisbaneMonthKey(new Date("2026-06-30T13:59:00Z"))).toBe("2026-06");
  });

  it("constants", () => {
    expect(TIER_THRESHOLDS).toEqual({ gold: 30, diamond: 80 });
    expect(TIER_DISCOUNT_PERCENT).toBe(5);
    expect(DIAMOND_MONTHLY_FREE_TOPPINGS).toBe(10);
  });
});
