import { describe, expect, it } from "vitest";
import { cappedDistinctCount, isUncountedTopping } from "./topping-rules";

describe("isUncountedTopping", () => {
  it("matches Oreo regardless of case / whitespace", () => {
    expect(isUncountedTopping("Oreo")).toBe(true);
    expect(isUncountedTopping("oreo")).toBe(true);
    expect(isUncountedTopping("  OREO  ")).toBe(true);
  });

  it("matches Oreo with a Square suffix", () => {
    expect(isUncountedTopping("Oreo (New)")).toBe(true);
    expect(isUncountedTopping("Oreo Crumble")).toBe(true);
  });

  it("does not match other toppings", () => {
    expect(isUncountedTopping("Pearls")).toBe(false);
    expect(isUncountedTopping("Pudding")).toBe(false);
    expect(isUncountedTopping("Aloe Vera")).toBe(false);
  });
});

describe("cappedDistinctCount", () => {
  const mods = [
    { id: "pearls", name: "Pearls" },
    { id: "pudding", name: "Pudding" },
    { id: "aloe", name: "Aloe Vera" },
    { id: "oreo", name: "Oreo" },
  ];

  it("counts each picked non-oreo topping once", () => {
    expect(cappedDistinctCount(mods, { pearls: 1, pudding: 2 })).toBe(2);
  });

  it("ignores quantity — distinct kinds only", () => {
    expect(cappedDistinctCount(mods, { pearls: 3 })).toBe(1);
  });

  it("excludes oreo from the count, even at high quantity", () => {
    expect(cappedDistinctCount(mods, { pearls: 1, oreo: 10 })).toBe(1);
    expect(cappedDistinctCount(mods, { oreo: 5 })).toBe(0);
  });

  it("ignores zero-count entries", () => {
    expect(cappedDistinctCount(mods, { pearls: 0, pudding: 1 })).toBe(1);
  });
});
