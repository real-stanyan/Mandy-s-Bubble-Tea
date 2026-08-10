import { describe, it, expect } from "vitest";
import { unsupportedPreferences } from "./preference-check";
import type { ModifierList } from "@/lib/catalog";

/** Taro Milk Tea as production actually ships it (probed 2026-08-11):
 *  SUGAR LEVEL is Standard/Extra only — there is no way to order it less
 *  sweet, which is exactly what the model promised a customer. */
const TARO_LISTS = [
  {
    id: "ML_SUGAR",
    name: "SUGAR LEVEL",
    minSelected: 0,
    maxSelected: 1,
    maxDistinct: null,
    maxPerKind: null,
    modifiers: [
      { id: "m1", name: "Standard Sugar", priceCents: null, ordinal: 0, onByDefault: true, soldOut: false },
      { id: "m2", name: "Extra Sugar", priceCents: null, ordinal: 1, onByDefault: false, soldOut: false },
    ],
  },
  {
    id: "ML_ICE",
    name: "ICE",
    minSelected: 1,
    maxSelected: 1,
    maxDistinct: null,
    maxPerKind: null,
    modifiers: [
      { id: "i1", name: "Normal Ice", priceCents: null, ordinal: 0, onByDefault: true, soldOut: false },
      { id: "i2", name: "Less Ice", priceCents: null, ordinal: 1, onByDefault: false, soldOut: false },
      { id: "i3", name: "No Ice", priceCents: null, ordinal: 2, onByDefault: false, soldOut: false },
      { id: "i4", name: "Warm", priceCents: null, ordinal: 3, onByDefault: false, soldOut: false },
    ],
  },
] as unknown as ModifierList[];

describe("unsupportedPreferences", () => {
  it("catches the real regression: 不要糖 on a Standard/Extra-only drink", () => {
    const errs = unsupportedPreferences("Taro Milk Tea不要糖", TARO_LISTS, "Taro Milk Tea");
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain("no sugar-free option");
    // The feedback must hand the model the real options, or its retry is
    // a reroll rather than a correction.
    expect(errs[0]).toContain("Standard Sugar, Extra Sugar");
  });

  it("catches reduced-sugar phrasings too", () => {
    for (const ask of ["少糖", "半糖", "less sugar", "half sugar"]) {
      expect(unsupportedPreferences(ask, TARO_LISTS, "Taro Milk Tea")).toHaveLength(1);
    }
  });

  it("stays quiet when the catalog CAN honour the request", () => {
    expect(unsupportedPreferences("去冰", TARO_LISTS, "Taro Milk Tea")).toEqual([]);
    expect(unsupportedPreferences("no ice please", TARO_LISTS, "Taro Milk Tea")).toEqual([]);
    expect(unsupportedPreferences("要热的", TARO_LISTS, "Taro Milk Tea")).toEqual([]);
    expect(unsupportedPreferences("少冰", TARO_LISTS, "Taro Milk Tea")).toEqual([]);
  });

  it("stays quiet when the customer asked for nothing in particular", () => {
    expect(unsupportedPreferences("来一杯芋头奶茶", TARO_LISTS, "Taro Milk Tea")).toEqual([]);
    expect(unsupportedPreferences("what do you recommend?", TARO_LISTS, "Taro Milk Tea")).toEqual([]);
  });

  it("treats a missing list as unable, same as an inadequate one", () => {
    const noSugarList = TARO_LISTS.filter((ml) => ml.name !== "SUGAR LEVEL");
    const errs = unsupportedPreferences("不要糖", noSugarList, "Fresh Brew");
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain("no such list at all");
  });

  it("catches 奶盖 on a drink whose toppings have no cheese cream", () => {
    const lists = [
      {
        id: "ML_TOPPING",
        name: "TOPPING",
        minSelected: 0,
        maxSelected: 3,
        maxDistinct: 3,
        maxPerKind: 3,
        modifiers: [
          { id: "t1", name: "Pearls", priceCents: 80, ordinal: 0, onByDefault: false, soldOut: false },
        ],
      },
    ] as unknown as ModifierList[];
    expect(unsupportedPreferences("加奶盖", lists, "Oreo Brulee Milk Tea")).toHaveLength(1);
  });

  it("ignores a sold-out option — the customer still can't have it", () => {
    const lists = [
      {
        ...(TARO_LISTS[1] as unknown as { id: string }),
        id: "ML_ICE",
        name: "ICE",
        minSelected: 1,
        maxSelected: 1,
        maxDistinct: null,
        maxPerKind: null,
        modifiers: [
          { id: "i1", name: "Normal Ice", priceCents: null, ordinal: 0, onByDefault: true, soldOut: false },
          { id: "i3", name: "No Ice", priceCents: null, ordinal: 1, onByDefault: false, soldOut: true },
        ],
      },
    ] as unknown as ModifierList[];
    expect(unsupportedPreferences("去冰", lists, "Taro Milk Tea")).toHaveLength(1);
  });
});
