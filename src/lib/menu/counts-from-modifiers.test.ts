import { describe, expect, it } from "vitest";
import {
  buildCartLine,
  countsFromModifiers,
  type CountMap,
} from "@/lib/menu/build-cart-line";
import type { ItemVariation, MenuItem, ModifierList } from "@/lib/catalog";

const variation: ItemVariation = {
  id: "VAR_REGULAR",
  name: "Regular",
  priceCents: 750n,
  soldOut: false,
};

const item: MenuItem = {
  id: "ITEM_TARO",
  name: "Taro Milk Tea",
  description: null,
  imageUrl: null,
  priceCents: 750n,
  variationLabel: "Regular",
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
  maxDistinct: null,
  maxPerKind: null,
  maxTotal: 3,
  modifiers: [
    { id: "MOD_PEARL", name: "Pearls", priceCents: 80n, ordinal: 0, onByDefault: false, soldOut: false },
    { id: "MOD_PUDDING", name: "Pudding", priceCents: 80n, ordinal: 1, onByDefault: false, soldOut: false },
    { id: "MOD_OREO", name: "Oreo", priceCents: 100n, ordinal: 2, onByDefault: false, soldOut: false },
  ],
};

const lists = [sugarList, toppingList];

describe("countsFromModifiers", () => {
  it("is the inverse of buildCartLine for any positive selection", () => {
    const counts: CountMap = {
      ML_SUGAR: { MOD_HALF: 1 },
      ML_TOPPING: { MOD_PEARL: 2, MOD_OREO: 1 },
    };
    const line = buildCartLine({ item, variation, modifierLists: lists, counts });
    expect(line.modifiers).toHaveLength(4);
    expect(countsFromModifiers(lists, line.modifiers)).toEqual(counts);
  });

  it("drops a modifier the catalog no longer offers", () => {
    expect(
      countsFromModifiers(lists, [{ id: "MOD_HALF" }, { id: "MOD_RETIRED" }]),
    ).toEqual({ ML_SUGAR: { MOD_HALF: 1 } });
  });

  it("keeps TOP 10 locked toppings at a floor of one", () => {
    // The line was saved before the topping was locked (or lost it): the
    // edit form still cannot show a Top 10 build without its topping.
    expect(countsFromModifiers(lists, [{ id: "MOD_FULL" }], ["Pudding"])).toEqual({
      ML_SUGAR: { MOD_FULL: 1 },
      ML_TOPPING: { MOD_PUDDING: 1 },
    });
    // ...and does not double a topping the line already carries.
    expect(
      countsFromModifiers(lists, [{ id: "MOD_PUDDING" }, { id: "MOD_PUDDING" }], ["Pudding"]),
    ).toEqual({ ML_TOPPING: { MOD_PUDDING: 2 } });
  });

  it("returns an empty map for a line with no modifiers", () => {
    expect(countsFromModifiers(lists, [])).toEqual({});
  });
});
