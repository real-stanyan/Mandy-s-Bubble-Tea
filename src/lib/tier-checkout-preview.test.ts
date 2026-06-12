// src/lib/tier-checkout-preview.test.ts
import { describe, expect, it } from "vitest";
import { tierCheckoutPreview } from "@/lib/tier-checkout-preview";
import type { CupRecord } from "@/lib/tier-toppings";

const cup = (unitPrice: bigint, toppingPrices: bigint[]): CupRecord => ({
  unitPrice,
  toppingPrices,
});

describe("tierCheckoutPreview", () => {
  it("silver → all zeros regardless of cart contents", () => {
    const result = tierCheckoutPreview({
      tier: "silver",
      cups: [cup(900n, [100n, 80n]), cup(750n, [60n])],
      rewardCount: 0,
      toppingsRemaining: 10,
      subtotal: 1890n,
      rewardDiscount: 0n,
      welcomeDiscount: 0n,
      igFollowDiscount: 0n,
    });
    expect(result).toEqual({
      tierDiscountCents: 0n,
      toppingCoveredCents: 0n,
      toppingCoveredCount: 0,
    });
  });

  it("gold → 5% of (subtotal − welcome), no topping coverage even with cups+remaining", () => {
    // subtotal 1890, welcomeDiscount 200 → base = 1690 → 5% = 84n
    const result = tierCheckoutPreview({
      tier: "gold",
      cups: [cup(900n, [100n, 80n]), cup(750n, [60n])],
      rewardCount: 0,
      toppingsRemaining: 10,
      subtotal: 1890n,
      rewardDiscount: 0n,
      welcomeDiscount: 200n,
      igFollowDiscount: 0n,
    });
    expect(result.toppingCoveredCents).toBe(0n);
    expect(result.toppingCoveredCount).toBe(0);
    // base = 1890 - 200 = 1690; 5% = 84n (1690*5/100 = 84)
    expect(result.tierDiscountCents).toBe(84n);
  });

  it("diamond → toppings covered then 5% of remainder", () => {
    // cups: 900n[100n,80n] + 750n[60n], subtotal 1890n, remaining 10
    // pool = [100n, 80n, 60n] (all 3, most expensive first)
    // covered: take min(10, 3) = 3, amount = 240n, count = 3
    // base = 1890 - 0 - 0 - 0 - 240 = 1650
    // tier discount = (1650 * 5) / 100 = 82n
    const result = tierCheckoutPreview({
      tier: "diamond",
      cups: [cup(900n, [100n, 80n]), cup(750n, [60n])],
      rewardCount: 0,
      toppingsRemaining: 10,
      subtotal: 1890n,
      rewardDiscount: 0n,
      welcomeDiscount: 0n,
      igFollowDiscount: 0n,
    });
    expect(result.toppingCoveredCents).toBe(240n);
    expect(result.toppingCoveredCount).toBe(3);
    expect(result.tierDiscountCents).toBe(82n);
  });

  it("base floors at 0n when rewardDiscount ≥ subtotal", () => {
    // If reward discount covers more than subtotal, base should not go negative
    const result = tierCheckoutPreview({
      tier: "gold",
      cups: [cup(500n, [])],
      rewardCount: 1,
      toppingsRemaining: 0,
      subtotal: 500n,
      rewardDiscount: 600n,
      welcomeDiscount: 0n,
      igFollowDiscount: 0n,
    });
    expect(result.tierDiscountCents).toBe(0n);
    expect(result.toppingCoveredCents).toBe(0n);
  });

  it("rewardCount excludes cheapest cup's toppings (mirror server case)", () => {
    // cups: 900n[100n,80n] + 750n[60n], rewardCount 1, rewardDiscount 750n
    // cheapest cup (750n) is excluded → pool from 900n cup only: [100n, 80n]
    // covered: take min(10, 2) = 2, amount = 180n
    // base = 1650 - 750 - 180 = 720, wait: subtotal=1650, rewardDiscount=750, toppingCovered=180
    // but tier is diamond here; base = 1650 - 750 - 180 = 720? No - let's re-read spec:
    // spec says: rewardCount 1, rewardDiscount 810n → pool [100,80]=180n, base 1890−810−180=900n → 45n
    // So: subtotal=1890, rewardDiscount=810, rewardCount=1 (excludes cheapest=750n cup from topping pool)
    // pool from remaining cups [900n[100n,80n]]: [100n, 80n] = 180n
    // toppingCoveredCents = 180n
    // base = 1890 - 810 - 0 - 0 - 180 = 900n
    // tierDiscount = (900 * 5) / 100 = 45n
    const result = tierCheckoutPreview({
      tier: "diamond",
      cups: [cup(900n, [100n, 80n]), cup(750n, [60n])],
      rewardCount: 1,
      toppingsRemaining: 10,
      subtotal: 1890n,
      rewardDiscount: 810n,
      welcomeDiscount: 0n,
      igFollowDiscount: 0n,
    });
    expect(result.toppingCoveredCents).toBe(180n);
    expect(result.toppingCoveredCount).toBe(2);
    expect(result.tierDiscountCents).toBe(45n);
  });
});
