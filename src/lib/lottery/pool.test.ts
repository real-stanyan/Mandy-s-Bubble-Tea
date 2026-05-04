import { describe, expect, it } from "vitest";
import { parsePrizePool, totalWeight, validatePrizePool } from "./pool";

const VALID_POOL = [
  { tier_id: "thank_you", weight: 50, type: "thank_you", payload: {} },
  {
    tier_id: "free_topping",
    weight: 20,
    type: "digital",
    payload: { kind: "free_modifier", modifier_id: "mod_abc" },
  },
  {
    tier_id: "discount_3",
    weight: 15,
    type: "digital",
    payload: { kind: "discount", amount_cents: 300 },
  },
  {
    tier_id: "sticker",
    weight: 10,
    type: "physical",
    payload: { label: "Sticker" },
  },
  {
    tier_id: "discount_5",
    weight: 4,
    type: "digital",
    payload: { kind: "discount", amount_cents: 500 },
  },
  {
    tier_id: "free_drink",
    weight: 1,
    type: "digital",
    payload: { kind: "free_drink", max_cents: 1000 },
  },
];

describe("parsePrizePool", () => {
  it("parses a valid pool from JSON", () => {
    const pool = parsePrizePool(JSON.stringify(VALID_POOL));
    expect(pool).toHaveLength(6);
    expect(pool[0].tier_id).toBe("thank_you");
  });

  it("parses a valid pool from a JS object (jsonb returns parsed)", () => {
    const pool = parsePrizePool(VALID_POOL);
    expect(pool).toHaveLength(6);
  });

  it("throws on non-array input", () => {
    expect(() => parsePrizePool("{}")).toThrow(/array/);
  });

  it("throws on missing weight", () => {
    expect(() =>
      parsePrizePool([{ tier_id: "x", type: "thank_you", payload: {} }]),
    ).toThrow(/weight/);
  });

  it("throws on negative weight", () => {
    expect(() =>
      parsePrizePool([
        { tier_id: "x", weight: -1, type: "thank_you", payload: {} },
      ]),
    ).toThrow(/weight/);
  });

  it("throws on duplicate tier_id", () => {
    expect(() =>
      parsePrizePool([
        { tier_id: "x", weight: 50, type: "thank_you", payload: {} },
        { tier_id: "x", weight: 50, type: "thank_you", payload: {} },
      ]),
    ).toThrow(/duplicate/);
  });

  it("throws on invalid prize_type", () => {
    expect(() =>
      parsePrizePool([
        { tier_id: "x", weight: 50, type: "bogus", payload: {} },
      ]),
    ).toThrow(/type/);
  });
});

describe("totalWeight", () => {
  it("sums weights", () => {
    expect(totalWeight(VALID_POOL)).toBe(100);
  });

  it("returns 0 for empty pool", () => {
    expect(totalWeight([])).toBe(0);
  });
});

describe("validatePrizePool", () => {
  it("accepts a valid pool", () => {
    expect(() => validatePrizePool(VALID_POOL)).not.toThrow();
  });

  it("rejects pool with zero total weight", () => {
    expect(() =>
      validatePrizePool([
        { tier_id: "x", weight: 0, type: "thank_you", payload: {} },
      ]),
    ).toThrow(/total weight/);
  });

  it("rejects discount payload missing amount_cents", () => {
    expect(() =>
      validatePrizePool([
        {
          tier_id: "d",
          weight: 1,
          type: "digital",
          payload: { kind: "discount" } as unknown as never,
        },
      ]),
    ).toThrow(/amount_cents/);
  });

  it("rejects free_modifier payload missing modifier_id", () => {
    expect(() =>
      validatePrizePool([
        {
          tier_id: "d",
          weight: 1,
          type: "digital",
          payload: { kind: "free_modifier" } as unknown as never,
        },
      ]),
    ).toThrow(/modifier_id/);
  });

  it("rejects physical payload missing label", () => {
    expect(() =>
      validatePrizePool([
        {
          tier_id: "p",
          weight: 1,
          type: "physical",
          payload: {} as unknown as never,
        },
      ]),
    ).toThrow(/label/);
  });
});
