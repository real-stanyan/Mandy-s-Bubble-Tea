import { describe, it, expect } from "vitest";
import {
  buildCartLine,
  buildDefaultCounts,
  unitPriceCentsFor,
  type CountMap,
} from "@/lib/menu/build-cart-line";
import type { MenuItem, ItemVariation, ModifierList } from "@/lib/catalog";

const variation: ItemVariation = {
  id: "VAR_LARGE",
  name: "Large",
  priceCents: 750n,
  soldOut: false,
};

const item: MenuItem = {
  id: "ITEM_TARO",
  name: "Taro Milk Tea",
  description: null,
  imageUrl: "https://example.test/taro.png",
  priceCents: 750n,
  variationLabel: "Large",
  variations: [variation],
  modifierListRefs: [],
  categoryIds: ["CAT_MILKY"],
  soldOut: false,
};

const sugarList: ModifierList = {
  id: "ML_SUGAR",
  name: "SUGAR",
  minSelected: 1,
  maxSelected: 1,
  maxDistinct: null,
  maxPerKind: 1,
  modifiers: [
    { id: "MOD_FULL", name: "100%", priceCents: null, ordinal: 0, onByDefault: true, soldOut: false },
    { id: "MOD_HALF", name: "50%", priceCents: null, ordinal: 1, onByDefault: false, soldOut: false },
  ],
};

const toppingList: ModifierList = {
  id: "ML_TOPPING",
  name: "TOPPING",
  minSelected: 0,
  maxSelected: null,
  maxDistinct: 3,
  maxPerKind: 3,
  modifiers: [
    { id: "MOD_PEARL", name: "Pearl", priceCents: 80n, ordinal: 0, onByDefault: false, soldOut: false },
    { id: "MOD_OREO", name: "Oreo", priceCents: 100n, ordinal: 1, onByDefault: false, soldOut: false },
  ],
};

describe("buildDefaultCounts", () => {
  it("seeds onByDefault modifiers at count 1", () => {
    expect(buildDefaultCounts([sugarList, toppingList])).toEqual({
      ML_SUGAR: { MOD_FULL: 1 },
    });
  });

  it("seeds TOP 10 locked toppings on top of onByDefault", () => {
    const counts = buildDefaultCounts([sugarList, toppingList], ["Pearl"]);
    expect(counts.ML_TOPPING).toEqual({ MOD_PEARL: 1 });
    expect(counts.ML_SUGAR).toEqual({ MOD_FULL: 1 });
  });
});

describe("unitPriceCentsFor", () => {
  it("adds modifier upcharges times their count", () => {
    const counts: CountMap = { ML_SUGAR: { MOD_HALF: 1 }, ML_TOPPING: { MOD_PEARL: 2 } };
    expect(unitPriceCentsFor(variation, [sugarList, toppingList], counts)).toBe(910n);
  });

  it("treats null modifier price as free", () => {
    const counts: CountMap = { ML_SUGAR: { MOD_FULL: 1 } };
    expect(unitPriceCentsFor(variation, [sugarList, toppingList], counts)).toBe(750n);
  });

  // Deliberate: matches lineUnitPrice() in src/store/cart.ts, which sums
  // variationPriceCents + modifiers with the variation price already
  // defaulted to 0n. The pre-refactor ItemOrderForm guard
  // (`if (!selectedVariation?.priceCents) return 0n`) was a falsy check,
  // so a 0n-priced variation zeroed the ENTIRE total including modifier
  // upcharges — the item modal showed $0.00 while the cart showed the
  // real with-toppings price. unitPriceCentsFor must not reproduce that
  // divergence: a 0n base still accrues modifier upcharges.
  it("still accrues modifier upcharges when variation priceCents is 0n", () => {
    const freeVariation: ItemVariation = { ...variation, priceCents: 0n };
    const counts: CountMap = { ML_TOPPING: { MOD_PEARL: 1 } };
    expect(unitPriceCentsFor(freeVariation, [toppingList], counts)).toBe(80n);
  });

  // Deliberate, same reasoning as above — priceCents: null (Square's
  // "no price set") must not zero out modifier upcharges either.
  // `variation.priceCents ?? 0n` only substitutes for null/undefined, so
  // this and the 0n case both fall through to accruing upcharges normally.
  it("still accrues modifier upcharges when variation priceCents is null", () => {
    const noPriceVariation: ItemVariation = { ...variation, priceCents: null };
    const counts: CountMap = { ML_TOPPING: { MOD_PEARL: 1 } };
    expect(unitPriceCentsFor(noPriceVariation, [toppingList], counts)).toBe(80n);
  });
});

describe("buildCartLine", () => {
  it("repeats a modifier once per count, matching ItemOrderForm", () => {
    const counts: CountMap = { ML_SUGAR: { MOD_HALF: 1 }, ML_TOPPING: { MOD_PEARL: 2 } };
    const line = buildCartLine({
      item,
      variation,
      modifierLists: [sugarList, toppingList],
      counts,
    });
    expect(line.modifiers).toEqual([
      { id: "MOD_HALF", name: "50%", priceCents: 0n },
      { id: "MOD_PEARL", name: "Pearl", priceCents: 80n },
      { id: "MOD_PEARL", name: "Pearl", priceCents: 80n },
    ]);
    expect(line.itemId).toBe("ITEM_TARO");
    expect(line.itemName).toBe("Taro Milk Tea");
    expect(line.itemImageUrl).toBe("https://example.test/taro.png");
    expect(line.variationId).toBe("VAR_LARGE");
    expect(line.variationPriceCents).toBe(750n);
  });

  it("prefers displayName over the raw item name", () => {
    const line = buildCartLine({
      item,
      displayName: "Taro Milk Tea (TOP 10)",
      variation,
      modifierLists: [sugarList],
      counts: { ML_SUGAR: { MOD_FULL: 1 } },
    });
    expect(line.itemName).toBe("Taro Milk Tea (TOP 10)");
  });

  it("skips modifiers whose count is zero", () => {
    const counts: CountMap = { ML_TOPPING: { MOD_PEARL: 0, MOD_OREO: 1 } };
    const line = buildCartLine({ item, variation, modifierLists: [toppingList], counts });
    expect(line.modifiers).toEqual([{ id: "MOD_OREO", name: "Oreo", priceCents: 100n }]);
  });
});
