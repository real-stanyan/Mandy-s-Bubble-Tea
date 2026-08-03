import { describe, expect, it } from "vitest";
import type { Menu, MenuItem, ModifierList } from "@/lib/catalog";
import { findSoldOutLineNames } from "./sold-out";

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
