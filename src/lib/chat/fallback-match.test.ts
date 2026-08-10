import { describe, it, expect } from "vitest";
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
    const hits = fallbackMatch(menu, "brown sugar");
    expect(hits[0]?.itemId).toBe("ITEM_BROWN");
  });

  it("never suggests a sold-out item", () => {
    expect(fallbackMatch(menu, "winter melon")).toEqual([]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(fallbackMatch(menu, "espresso martini")).toEqual([]);
  });

  it("dedupes an item listed under two categories", () => {
    const hits = fallbackMatch(menu, "taro");
    expect(hits.filter((h) => h.itemId === "ITEM_TARO")).toHaveLength(1);
  });

  it("honours the limit", () => {
    expect(fallbackMatch(menu, "tea", 2).length).toBeLessThanOrEqual(2);
  });
});
