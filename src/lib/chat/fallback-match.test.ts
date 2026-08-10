import { describe, it, expect } from "vitest";
import type { Menu } from "@/lib/catalog";
import { fallbackMatch } from "@/lib/chat/fallback-match";
import { fixtureMenu } from "@/lib/chat/__fixtures__/menu";

const menu = fixtureMenu();

describe("fallbackMatch", () => {
  it("finds an item by an exact word from its name", () => {
    const hits = fallbackMatch(menu, "I want taro please");
    expect(hits[0]?.itemId).toBe("ITEM_TARO");
    expect(hits[0]?.categorySlug).toBe("milky");
  });

  it("is case insensitive", () => {
    expect(fallbackMatch(menu, "MANGO")[0]?.itemId).toBe("ITEM_MANGO");
  });

  it("ranks a two-word match above a one-word match", () => {
    const hits = fallbackMatch(menu, "brown sugar milk");
    expect(hits[0]?.itemId).toBe("ITEM_BROWN");
    // Assert that result contains multiple entries to prove ordering.
    // ITEM_BROWN scores 3 (brown, sugar, milk), Taro entries score 1 (milk).
    expect(hits.length).toBeGreaterThan(1);
  });

  it("never suggests a sold-out item", () => {
    expect(fallbackMatch(menu, "winter melon")).toEqual([]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(fallbackMatch(menu, "espresso martini")).toEqual([]);
  });

  it("dedupes an item listed under two categories", () => {
    // Build a local menu copy where the same item (same id) is listed under two categories.
    // Do NOT modify the shared fixture — two later tasks depend on its current structure.
    const taroItem = menu.itemsBySlug.get("milky")![0]!; // ITEM_TARO
    const menuWithDupTaro: Menu = {
      categories: menu.categories,
      itemsBySlug: new Map([
        ["milky", [taroItem]],
        ["fruity", menu.itemsBySlug.get("fruity")!],
        // Add the SAME taro item to top-10, creating a duplicate entry.
        ["top-10", [taroItem]],
      ]),
      uncategorizedItems: menu.uncategorizedItems,
      modifierLists: menu.modifierLists,
    };

    const hits = fallbackMatch(menuWithDupTaro, "taro");
    expect(hits.filter((h) => h.itemId === "ITEM_TARO")).toHaveLength(1);
  });

  it("honours the limit", () => {
    const hits = fallbackMatch(menu, "milk tea", 2);
    expect(hits.length).toBe(2);
  });

  it("finds items by product vocabulary even when LLM is unavailable", () => {
    const hits = fallbackMatch(menu, "milk tea");
    expect(hits.length).toBeGreaterThan(0);
    // Should find at least one Taro or Brown Sugar milk tea.
    expect(hits.some((h) => h.itemId.startsWith("ITEM_") && h.categorySlug === "milky")).toBe(
      true,
    );
  });
});
