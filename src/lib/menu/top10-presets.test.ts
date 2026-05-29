import { describe, it, expect } from "vitest";
import {
  TOP10_CATEGORY_SLUG,
  getTop10Preset,
  lockedToppingsFor,
  displayNameFor,
  imageSlugFor,
  imageUrlFor,
  lockedToppingsPriceCents,
  lockedModifierIds,
  isLockedToppingName,
} from "./top10-presets";

describe("top10-presets", () => {
  it("slug constant is top-10", () => {
    expect(TOP10_CATEGORY_SLUG).toBe("top-10");
  });

  it("looks up presets case-insensitively by item name", () => {
    expect(getTop10Preset("Taro Milk Tea")?.lockedToppings).toEqual(["Pudding"]);
    expect(getTop10Preset("  taro milk tea ")?.lockedToppings).toEqual(["Pudding"]);
    expect(getTop10Preset("Four Seasons Fruit Tea")).toBeUndefined();
  });

  it("lockedToppingsFor only applies inside top-10", () => {
    expect(lockedToppingsFor("top-10", "Original Milk Tea")).toEqual([
      "Pearls",
      "Herbal Jelly",
      "Pudding",
    ]);
    expect(lockedToppingsFor("milk-tea", "Original Milk Tea")).toEqual([]);
    expect(lockedToppingsFor(undefined, "Original Milk Tea")).toEqual([]);
    expect(lockedToppingsFor("top-10", "Lemon Black Tea")).toEqual([]);
  });

  it("displayNameFor renames only inside top-10, else falls back to itemName", () => {
    expect(displayNameFor("top-10", "Original Milk Tea")).toBe(
      "Original Milk Tea Trio (Pearl, Grass Jelly & Pudding)",
    );
    expect(displayNameFor("top-10", "Taro Milk Tea")).toBe("Taro Milk Tea (with Pudding)");
    expect(displayNameFor("top-10", "Brown Sugar Milk Tea")).toBe(
      "Brown Sugar Milk Tea (with Pearls)",
    );
    // outside top-10 the raw catalog name is always used
    expect(displayNameFor("milk-tea", "Original Milk Tea")).toBe("Original Milk Tea");
    expect(displayNameFor("milk-tea", "Taro Milk Tea")).toBe("Taro Milk Tea");
    // a top-10 item without a preset still falls back to itemName
    expect(displayNameFor("top-10", "Lemon Black Tea")).toBe("Lemon Black Tea");
  });

  it("imageSlugFor returns the override slug only inside top-10", () => {
    expect(imageSlugFor("top-10", "Brown Sugar Milk Tea")).toBe("brown-sugar-milk-tea");
    expect(imageSlugFor("top-10", "Original Milk Tea")).toBe("original-milk-tea");
    // outside top-10: no override
    expect(imageSlugFor("milk-tea", "Brown Sugar Milk Tea")).toBeNull();
    expect(imageSlugFor(undefined, "Brown Sugar Milk Tea")).toBeNull();
    // top-10 item without a custom image
    expect(imageSlugFor("top-10", "Lemon Black Tea")).toBeNull();
  });

  it("imageUrlFor builds the public webp path or null", () => {
    expect(imageUrlFor("top-10", "Taro Milk Tea")).toBe("/image/top10/taro-milk-tea.webp");
    expect(imageUrlFor("top-10", "Mango Slushy")).toBe("/image/top10/mango-slushy.webp");
    expect(imageUrlFor("frozen", "Mango Slushy")).toBeNull();
    expect(imageUrlFor("top-10", "Lemon Black Tea")).toBeNull();
  });

  it("every preset with a displayName also ships a custom image", () => {
    // all 7 curated TOP 10 drinks should have both a rename and a photo
    for (const name of [
      "Brown Sugar Milk Tea",
      "Chocolate Frappe",
      "Lychee Iced Green Tea",
      "Mango Slushy",
      "Original Milk Tea",
      "Red Dragon Fruit Slushy",
      "Taro Milk Tea",
    ]) {
      expect(imageSlugFor("top-10", name), name).not.toBeNull();
      expect(displayNameFor("top-10", name), name).not.toBe(name);
    }
  });

  it("lockedToppingsPriceCents sums matched locked modifier prices inside top-10", () => {
    const mods = [
      { name: "Pearls", priceCents: 80 },
      { name: "Herbal Jelly", priceCents: 80 },
      { name: "Pudding", priceCents: 80 },
      { name: "Mango Jelly", priceCents: 80 },
    ];
    // single locked topping
    expect(lockedToppingsPriceCents("top-10", "Brown Sugar Milk Tea", mods)).toBe(80);
    // trio: three locked toppings
    expect(lockedToppingsPriceCents("top-10", "Original Milk Tea", mods)).toBe(240);
    // outside top-10: no surcharge even if modifiers exist
    expect(lockedToppingsPriceCents("milk-tea", "Brown Sugar Milk Tea", mods)).toBe(0);
    // top-10 item with no preset
    expect(lockedToppingsPriceCents("top-10", "Lemon Black Tea", mods)).toBe(0);
    // locked name missing from this item's modifiers → contributes 0 (no crash)
    expect(lockedToppingsPriceCents("top-10", "Brown Sugar Milk Tea", [])).toBe(0);
  });

  it("isLockedToppingName matches case-insensitively and trims", () => {
    expect(isLockedToppingName("Pudding", ["Pudding"])).toBe(true);
    expect(isLockedToppingName(" pudding ", ["Pudding"])).toBe(true);
    expect(isLockedToppingName("Pearls", ["Pudding"])).toBe(false);
  });

  it("lockedModifierIds finds matching modifier ids across lists", () => {
    const lists = [
      {
        id: "L1",
        modifiers: [
          { id: "m1", name: "Pearls" },
          { id: "m2", name: "Pudding" },
          { id: "m3", name: "Sago" },
        ],
      },
      { id: "L2", modifiers: [{ id: "m4", name: "Standard Sugar" }] },
    ];
    expect(lockedModifierIds(lists, ["Pearls", "Pudding"])).toEqual([
      { listId: "L1", modifierId: "m1" },
      { listId: "L1", modifierId: "m2" },
    ]);
    expect(lockedModifierIds(lists, ["Mango Jelly"])).toEqual([]);
    expect(lockedModifierIds([], ["Pearls"])).toEqual([]);
  });
});
