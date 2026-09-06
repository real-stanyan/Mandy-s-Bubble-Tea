import { describe, it, expect } from "vitest";
import {
  originalPriceCentsFor,
  orderedWeeklySpecialNames,
  normalizeItemName,
  WEEKLY_SPECIALS,
} from "./weekly-specials";

describe("weekly-specials", () => {
  // Driven off the config instead of hard-coded drink names: the shelf
  // rotates every week or two, and a test that names this week's promo
  // fails on the next rotation for a reason that isn't a bug.
  it("looks up the original price case-insensitively by item name", () => {
    const { name, originalPriceCents } = WEEKLY_SPECIALS[0];
    expect(originalPriceCentsFor(name)).toBe(originalPriceCents);
    expect(originalPriceCentsFor(`  ${name.toLowerCase()} `)).toBe(originalPriceCents);
    expect(originalPriceCentsFor(name.toUpperCase())).toBe(originalPriceCents);
  });

  // The catalog has held names with doubled spaces before ("Pineapple
  // Black Tea" with two, while it was on the shelf). A trim-only key drops
  // such an item out of the shelf without a word of warning.
  it("matches names whose internal whitespace differs from the config", () => {
    expect(originalPriceCentsFor("Yakult  Green Tea")).toBe(620);
    expect(normalizeItemName("  Yakult   Green  Tea ")).toBe("yakult green tea");
  });

  it("returns null for an item that isn't currently a special", () => {
    expect(originalPriceCentsFor("Taro Milk Tea")).toBeNull();
  });

  it("orderedWeeklySpecialNames preserves the config's display order, normalized", () => {
    expect(orderedWeeklySpecialNames()).toEqual(
      WEEKLY_SPECIALS.map((s) => s.name.toLowerCase()),
    );
  });
});
