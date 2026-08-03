import { describe, it, expect } from "vitest";
import {
  originalPriceCentsFor,
  orderedWeeklySpecialNames,
  WEEKLY_SPECIALS,
} from "./weekly-specials";

describe("weekly-specials", () => {
  it("looks up the original price case-insensitively by item name", () => {
    expect(originalPriceCentsFor("Honeydew Milk Tea")).toBe(620);
    expect(originalPriceCentsFor("  honeydew milk tea ")).toBe(620);
    expect(originalPriceCentsFor("HONEYDEW MILK TEA")).toBe(620);
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
