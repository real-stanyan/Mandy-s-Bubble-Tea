import { describe, it, expect } from "vitest";
import {
  cupCountFor,
  bulkDiscountPercent,
  BULK_SELF_SERVE_MAX_CUPS,
  BULK_TOO_LARGE_MESSAGE,
} from "./bulk-order";

describe("cupCountFor", () => {
  it("sums quantities across lines, flooring garbage to at least 1", () => {
    expect(cupCountFor([{ quantity: 3 }, { quantity: 7 }])).toBe(10);
    expect(cupCountFor([{ quantity: 0 }, { quantity: 2.9 }])).toBe(3);
  });
});

describe("bulkDiscountPercent — the brackets are the policy", () => {
  it.each([
    [1, 0],
    [9, 0],
    [10, 10],
    [19, 10],
    [20, 15],
    [29, 15],
    [30, 20],
    [50, 20],
    [51, 0], // past the self-serve ceiling: no discount, checkout refuses anyway
    [80, 0],
  ])("%i cups → %i%%", (cups, pct) => {
    expect(bulkDiscountPercent(cups)).toBe(pct);
  });
});

describe("the ceiling and its message", () => {
  it("caps self-serve at 50 and the message carries the phrase order-block matches", () => {
    expect(BULK_SELF_SERVE_MAX_CUPS).toBe(50);
    // classifyOrderBlock() keys on this phrase — see order-block.ts.
    expect(BULK_TOO_LARGE_MESSAGE).toContain("over 50 cups");
  });
});
