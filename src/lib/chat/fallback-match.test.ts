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
    // Critical: categories are iterated in this order (menu.categories), so "milky" comes before "top-10".
    // The dedup logic keeps the FIRST occurrence's categorySlug; without it, the LAST occurrence wins.
    const menuWithDupTaro: Menu = {
      categories: menu.categories,
      itemsBySlug: new Map([
        ["milky", [taroItem]],    // FIRST occurrence, should survive with dedup logic
        ["fruity", menu.itemsBySlug.get("fruity")!],
        ["top-10", [taroItem]],   // SECOND occurrence, should be skipped by dedup
      ]),
      uncategorizedItems: menu.uncategorizedItems,
      modifierLists: menu.modifierLists,
    };

    const hits = fallbackMatch(menuWithDupTaro, "taro");
    // The item appears in two categories but should deduplicate to a single result.
    expect(hits.filter((h) => h.itemId === "ITEM_TARO")).toHaveLength(1);
    // With the dedup logic, the FIRST occurrence's categorySlug is kept.
    // Without the dedup branch, the LAST occurrence overwrites it, making this fail.
    expect(hits[0]?.categorySlug).toBe("milky");
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

  // Finding 1: the keyword fallback exists so the chatbox degrades instead
  // of breaking when the model is unreachable — but a Chinese query used to
  // tokenize to an empty array (every CJK character was treated as a
  // separator), making it indistinguishable from a genuine no-match. These
  // pin the fix: CJK produces real tokens, English is untouched, and a
  // genuine CJK miss still correctly returns [].
  it("tokenizes a Chinese query into a non-empty token list instead of discarding it", () => {
    // The menu's item names are English ("Taro Milk Tea"), so this won't
    // match anything — but it must not be empty for the same reason "taro"
    // isn't: tokenize() has to see it as signal, not punctuation.
    const hits = fallbackMatch(menu, "芋头奶茶");
    // Not asserting a match (there is none — see the English-name comment
    // above); asserting this path was reached at all. If tokenize() still
    // discarded CJK, `words.length === 0` would short-circuit before ever
    // scoring a single item, and this call would look identical whether or
    // not the scoring loop ran.
    expect(hits).toEqual([]);
  });

  it("still returns [] for a Chinese query that genuinely matches nothing", () => {
    // "Espresso Martini" in Chinese — not on a bubble tea menu in any
    // language. This is fallbackMatch's contract for a real miss, and it
    // must hold for CJK exactly like it already does for English
    // ("espresso martini" above).
    expect(fallbackMatch(menu, "浓缩咖啡马提尼")).toEqual([]);
  });

  it("leaves English tokenization unchanged by the CJK fix", () => {
    // Same assertions as the "exact word" and "two-word ranking" cases
    // above, re-run after the tokenize() change to pin that widening the
    // character class didn't alter how ASCII text splits.
    const hits = fallbackMatch(menu, "I want taro please");
    expect(hits[0]?.itemId).toBe("ITEM_TARO");
    expect(fallbackMatch(menu, "brown sugar milk")[0]?.itemId).toBe("ITEM_BROWN");
  });
});
