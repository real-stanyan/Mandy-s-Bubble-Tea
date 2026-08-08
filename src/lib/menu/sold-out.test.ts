import { describe, expect, it } from "vitest";
import type { Menu, MenuItem, ModifierList } from "@/lib/catalog";
import {
  findSoldOutLineNames,
  soldOutBadgeLabel,
  soldOutLockedToppingNames,
} from "./sold-out";
import { TOP10_CATEGORY_SLUG } from "@/lib/menu/top10-presets";

/**
 * Pins the sold-out gate shared by /api/orders and /api/orders/quote. Before
 * this existed, only /api/orders checked it — the quote route priced a
 * sold-out topping normally, so checkout showed a working Pay button right up
 * until the create call rejected the order with a message the UI didn't know
 * how to explain (surfaced as a generic "Payment Failed" dialog).
 */

function item(
  id: string,
  variations: { id: string; name: string; soldOut: boolean }[],
): MenuItem {
  return {
    id,
    name: id,
    description: null,
    imageUrl: null,
    priceCents: null,
    variationLabel: null,
    variations: variations.map((v) => ({ ...v, priceCents: null })),
    soldOut: variations.every((v) => v.soldOut),
    modifierListRefs: [],
    categoryIds: [],
  };
}

function menuOf(opts: {
  items?: MenuItem[];
  modifierLists?: { id: string; modifiers: { id: string; name: string; soldOut: boolean }[] }[];
}): Menu {
  const modifierLists = new Map<string, ModifierList>();
  for (const ml of opts.modifierLists ?? []) {
    modifierLists.set(ml.id, {
      id: ml.id,
      name: ml.id,
      minSelected: 0,
      maxSelected: null,
      maxDistinct: null,
      maxPerKind: null,
      modifiers: ml.modifiers.map((m) => ({ ...m, priceCents: null, ordinal: 0, onByDefault: false })),
    });
  }
  return {
    categories: [],
    itemsBySlug: new Map([["cat", opts.items ?? []]]),
    uncategorizedItems: [],
    modifierLists,
  };
}

describe("findSoldOutLineNames", () => {
  it("returns nothing when no line references a sold-out variation or modifier", () => {
    const menu = menuOf({
      items: [item("Brown Sugar Milk Tea", [{ id: "V1", name: "Large", soldOut: false }])],
      modifierLists: [
        { id: "ML1", modifiers: [{ id: "M1", name: "Pearls", soldOut: false }] },
      ],
    });
    const out = findSoldOutLineNames(menu, [
      { variationId: "V1", modifiers: [{ id: "M1" }] },
    ]);
    expect(out).toEqual([]);
  });

  it("flags a sold-out variation by item + variation name", () => {
    const menu = menuOf({
      items: [item("Taro Milk Tea", [{ id: "V1", name: "Large", soldOut: true }])],
    });
    const out = findSoldOutLineNames(menu, [
      { variationId: "V1", modifiers: [] },
    ]);
    expect(out).toEqual(["Taro Milk Tea (Large)"]);
  });

  it("flags a sold-out modifier even when the variation itself is fine — the Top 10 bundling case", () => {
    // e.g. "Brown Sugar Milk Tea (with Pearls)" — the drink is in stock, but
    // its locked topping isn't, so the combo can't be fulfilled.
    const menu = menuOf({
      items: [item("Brown Sugar Milk Tea", [{ id: "V1", name: "Large", soldOut: false }])],
      modifierLists: [
        { id: "ML1", modifiers: [{ id: "M1", name: "Pearls", soldOut: true }] },
      ],
    });
    const out = findSoldOutLineNames(menu, [
      { variationId: "V1", modifiers: [{ id: "M1" }] },
    ]);
    expect(out).toEqual(["Pearls"]);
  });

  it("dedupes repeated sold-out names across multiple lines", () => {
    const menu = menuOf({
      items: [item("Taro Milk Tea", [{ id: "V1", name: "Large", soldOut: true }])],
    });
    const out = findSoldOutLineNames(menu, [
      { variationId: "V1", modifiers: [] },
      { variationId: "V1", modifiers: [] },
    ]);
    expect(out).toEqual(["Taro Milk Tea (Large)"]);
  });

  it("ignores a variation/modifier id the catalog doesn't recognize — that's the separate unknownVariationIds gate, not sold-out", () => {
    const menu = menuOf({ items: [] });
    const out = findSoldOutLineNames(menu, [
      { variationId: "GONE", modifiers: [{ id: "ALSO_GONE" }] },
    ]);
    expect(out).toEqual([]);
  });
});

/**
 * The rule this pins: a TOP 10 card must never look orderable when the drink's
 * locked topping is sold out. The toppings can't be removed, so the drink is
 * unorderable — and `item.soldOut` alone can't see that, which is exactly how
 * #101's dead end survived (normal-looking card → disabled button, no reason).
 */

// Taro Milk Tea's locked topping in TOP10_PRESETS is "Pudding".
function taroWithPudding(pudding: { soldOut: boolean }, extra: MenuItem["modifierListRefs"] = []) {
  const it = item("Taro Milk Tea", [{ id: "V1", name: "Regular", soldOut: false }]);
  it.modifierListRefs = [
    { id: "ML_TOPPINGS", minOverride: null, maxOverride: null, modifierOverrides: [] },
    ...extra,
  ];
  const menu = menuOf({
    items: [it],
    modifierLists: [
      {
        id: "ML_TOPPINGS",
        modifiers: [
          { id: "M_PUDDING", name: "Pudding", soldOut: pudding.soldOut },
          { id: "M_PEARLS", name: "Pearls", soldOut: true },
        ],
      },
    ],
  });
  return { menu, item: it };
}

describe("soldOutLockedToppingNames", () => {
  it("names the locked topping that is sold out", () => {
    const { menu, item: it } = taroWithPudding({ soldOut: true });
    expect(soldOutLockedToppingNames(menu, TOP10_CATEGORY_SLUG, it)).toEqual(["Pudding"]);
  });

  it("stays empty when the locked topping is in stock — a sold-out OPTIONAL topping is not a dead end", () => {
    // "Pearls" is sold out in this fixture but is not locked for Taro, so the
    // customer can simply not pick it. Only locked toppings block the drink.
    const { menu, item: it } = taroWithPudding({ soldOut: false });
    expect(soldOutLockedToppingNames(menu, TOP10_CATEGORY_SLUG, it)).toEqual([]);
  });

  it("stays empty outside TOP 10 — the same drink there has the topping optional", () => {
    const { menu, item: it } = taroWithPudding({ soldOut: true });
    expect(soldOutLockedToppingNames(menu, "milky", it)).toEqual([]);
    expect(soldOutLockedToppingNames(menu, undefined, it)).toEqual([]);
  });

  it("stays empty for a TOP 10 drink with no preset", () => {
    const it = item("Some Drink Not In Top 10", [{ id: "V1", name: "Regular", soldOut: false }]);
    const menu = menuOf({ items: [it] });
    expect(soldOutLockedToppingNames(menu, TOP10_CATEGORY_SLUG, it)).toEqual([]);
  });

  it("ignores a modifier list ref the catalog can't resolve rather than throwing", () => {
    const { menu, item: it } = taroWithPudding({ soldOut: true }, [
      { id: "ML_GONE", minOverride: null, maxOverride: null, modifierOverrides: [] },
    ]);
    expect(soldOutLockedToppingNames(menu, TOP10_CATEGORY_SLUG, it)).toEqual(["Pudding"]);
  });
});

describe("soldOutBadgeLabel", () => {
  it("says nothing when nothing is sold out", () => {
    expect(soldOutBadgeLabel([])).toBeNull();
  });

  it("names one topping", () => {
    expect(soldOutBadgeLabel(["Pudding"])).toBe("Pudding sold out");
  });

  it("names two", () => {
    expect(soldOutBadgeLabel(["Pearls", "Pudding"])).toBe("Pearls & Pudding sold out");
  });

  it("counts instead of listing once a card can't hold the names", () => {
    // The Original Milk Tea Trio locks three at once.
    expect(soldOutBadgeLabel(["Pearls", "Herbal Jelly", "Pudding"])).toBe(
      "3 toppings sold out",
    );
  });
});
