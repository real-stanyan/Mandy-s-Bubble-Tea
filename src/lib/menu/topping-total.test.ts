import { describe, it, expect } from "vitest";
import { cappedTotalCount, isUncountedTopping } from "./topping-rules";

const MODS = [
  { id: "pearl", name: "Pearl" },
  { id: "jelly", name: "Lychee Jelly" },
  { id: "aloe", name: "Aloe Vera" },
  { id: "oreo", name: "Oreo" },
];

/**
 * The house rule as of 2026-08-14: three toppings on a drink, in total, and
 * Oreo is free.
 *
 * The rule it replaced was "up to 3 kinds, max 3 of each" — which allowed
 * nine toppings on one cup while the menu said "up to 3". These tests exist
 * because the difference between those two readings is a drink the shop
 * gives away.
 */
describe("total topping cap", () => {
  it("counts quantity, not kinds", () => {
    // Three of one thing is three, not one. Under the old rule this was a
    // single kind and therefore fine.
    expect(cappedTotalCount(MODS, { pearl: 3 })).toBe(3);
  });

  it("adds up across different toppings", () => {
    expect(cappedTotalCount(MODS, { pearl: 2, jelly: 1 })).toBe(3);
  });

  it("does not count Oreo", () => {
    // The exemption is the rule's other half: three toppings PLUS Oreo, not
    // three including it. Counting Oreo here would quietly shrink the drink.
    expect(cappedTotalCount(MODS, { pearl: 3, oreo: 5 })).toBe(3);
    expect(cappedTotalCount(MODS, { oreo: 10 })).toBe(0);
  });

  it("is zero when nothing is picked", () => {
    expect(cappedTotalCount(MODS, {})).toBe(0);
  });

  it("recognises Oreo however Square has renamed it", () => {
    // Matched as a substring on purpose: a rename to "Oreo (New)" must keep
    // the exemption, and a rename away from Oreo safely rejoins the cap.
    expect(isUncountedTopping("Oreo")).toBe(true);
    expect(isUncountedTopping("  oreo crumble ")).toBe(true);
    expect(isUncountedTopping("Pearl")).toBe(false);
  });

  it("says what is over and what is exactly at the limit", () => {
    const limit = 3;
    expect(cappedTotalCount(MODS, { pearl: 1, jelly: 1, aloe: 1 })).toBe(limit);
    expect(cappedTotalCount(MODS, { pearl: 2, jelly: 2 })).toBeGreaterThan(limit);
    // And the combination the shop most wants to allow: a full three plus
    // as much Oreo as the customer likes.
    expect(cappedTotalCount(MODS, { pearl: 1, jelly: 1, aloe: 1, oreo: 3 })).toBe(
      limit,
    );
  });
});
