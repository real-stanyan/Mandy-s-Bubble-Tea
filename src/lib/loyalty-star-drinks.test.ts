import { describe, expect, it, vi } from "vitest";

// The module under test also exports the Square-backed fetcher, and
// @/lib/square throws at import time without credentials (the default suite
// is offline by hard rule). Same mock shape as loyalty.accrue.test.ts —
// nothing here calls through it.
vi.mock("@/lib/square", () => ({
  squareClient: {},
}));

import { assignStarDrinks } from "./loyalty-star-drinks";

/**
 * The rule this pins: every filled pip on the membership card either names the
 * exact cup that earned it, or admits it doesn't know (null → plain star).
 * Progress must never look wrong because attribution failed.
 *
 * Events arrive NEWEST first (Square's searchEvents order); the result is
 * OLDEST first so index i lines up with filled pip i.
 */

describe("assignStarDrinks", () => {
  it("pairs one star with one cup, oldest first", () => {
    const drinks = assignStarDrinks(
      [
        { points: 1, orderId: "B" }, // newest
        { points: 1, orderId: "A" }, // oldest
      ],
      { A: ["Taro Milk Tea"], B: ["Mango Slushy"] },
      2,
    );
    expect(drinks).toEqual(["Taro Milk Tea", "Mango Slushy"]);
  });

  it("expands a multi-cup order into one star per cup", () => {
    const drinks = assignStarDrinks(
      [{ points: 2, orderId: "A" }],
      { A: ["Brown Sugar Milk Tea", "Lychee Iced Green Tea"] },
      2,
    );
    expect(drinks).toEqual([
      "Lychee Iced Green Tea",
      "Brown Sugar Milk Tea",
    ]);
  });

  it("only attributes the current cycle after a redemption wrapped the balance", () => {
    // 12 lifetime stars, 9 spent on a free drink, 3 left. Only the newest
    // 3 may be attributed — the older events were redeemed away.
    const drinks = assignStarDrinks(
      [
        { points: 1, orderId: "D" },
        { points: 1, orderId: "C" },
        { points: 1, orderId: "B" },
        { points: 9, orderId: "OLD" },
      ],
      {
        B: ["Peach Iced Green Tea"],
        C: ["Matcha Milk Tea"],
        D: ["Taro Milk Tea"],
        OLD: ["x", "x", "x", "x", "x", "x", "x", "x", "x"],
      },
      3,
    );
    expect(drinks).toEqual([
      "Peach Iced Green Tea",
      "Matcha Milk Tea",
      "Taro Milk Tea",
    ]);
  });

  it("fills null for an adjustment with no order — a star, but no cup to draw", () => {
    const drinks = assignStarDrinks(
      [
        { points: 1, orderId: "A" },
        { points: 1, orderId: null }, // manual ADJUST / support credit
      ],
      { A: ["Coconut Milk Tea"] },
      2,
    );
    expect(drinks).toEqual([null, "Coconut Milk Tea"]);
  });

  it("fills null when the order granted more points than it has cups", () => {
    // A double-star promo day: 2 points, 1 cup. The second star has no drink.
    const drinks = assignStarDrinks(
      [{ points: 2, orderId: "A" }],
      { A: ["Thai Milk Tea"] },
      2,
    );
    expect(drinks).toEqual([null, "Thai Milk Tea"]);
  });

  it("fills null when the order could not be fetched", () => {
    const drinks = assignStarDrinks([{ points: 1, orderId: "GONE" }], {}, 1);
    expect(drinks).toEqual([null]);
  });

  it("pads the shortfall when the balance outruns the event history", () => {
    // Balance says 3 this cycle but only one event came back (fetch limit,
    // or points granted by ADJUST which we don't query).
    const drinks = assignStarDrinks(
      [{ points: 1, orderId: "A" }],
      { A: ["Oolong Milk Tea"] },
      3,
    );
    expect(drinks).toEqual([null, null, "Oolong Milk Tea"]);
  });

  it("skips zero- and negative-point noise", () => {
    const drinks = assignStarDrinks(
      [
        { points: 0, orderId: "Z" },
        { points: -9, orderId: "R" }, // a reversal is not an earn
        { points: 1, orderId: "A" },
      ],
      { A: ["Jasmine Milk Tea"], Z: ["x"], R: ["x"] },
      1,
    );
    expect(drinks).toEqual(["Jasmine Milk Tea"]);
  });

  it("returns empty at zero stars — a fresh cycle draws nothing", () => {
    expect(assignStarDrinks([{ points: 1, orderId: "A" }], { A: ["x"] }, 0)).toEqual([]);
  });
});
