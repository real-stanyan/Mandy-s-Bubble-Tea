// src/lib/tier-toppings.test.ts
import { describe, expect, it } from "vitest";
import {
  collectPaidToppingUnits,
  coverFreeToppings,
  type CupRecord,
} from "@/lib/tier-toppings";

const cup = (unitPrice: bigint, toppingPrices: bigint[]): CupRecord => ({
  unitPrice,
  toppingPrices,
});

describe("collectPaidToppingUnits", () => {
  it("collects paid toppings from all cups, most expensive first", () => {
    const cups = [cup(900n, [80n, 100n]), cup(750n, [60n])];
    expect(collectPaidToppingUnits(cups, 0)).toEqual([100n, 80n, 60n]);
  });

  it("drops zero-price toppings (included/free modifiers are not quota)", () => {
    const cups = [cup(900n, [0n, 80n, 0n])];
    expect(collectPaidToppingUnits(cups, 0)).toEqual([80n]);
  });

  it("excludes the cheapest N cups (loyalty-reward cups, already free)", () => {
    const cups = [cup(900n, [100n]), cup(500n, [60n]), cup(700n, [80n])];
    expect(collectPaidToppingUnits(cups, 1)).toEqual([100n, 80n]);
  });

  it("excludeRewardCount >= cup count -> empty pool", () => {
    expect(collectPaidToppingUnits([cup(900n, [100n])], 5)).toEqual([]);
  });
});

describe("coverFreeToppings", () => {
  it("covers up to remaining, most expensive first", () => {
    const r = coverFreeToppings([100n, 80n, 60n], 2);
    expect(r.coveredCount).toBe(2);
    expect(r.amount).toBe(180n);
  });

  it("covers all when remaining exceeds pool", () => {
    const r = coverFreeToppings([100n, 80n], 10);
    expect(r.coveredCount).toBe(2);
    expect(r.amount).toBe(180n);
  });

  it("zero remaining or empty pool -> zero", () => {
    expect(coverFreeToppings([100n], 0)).toEqual({ coveredCount: 0, amount: 0n });
    expect(coverFreeToppings([], 5)).toEqual({ coveredCount: 0, amount: 0n });
    expect(coverFreeToppings([100n], -3)).toEqual({ coveredCount: 0, amount: 0n });
  });
});
