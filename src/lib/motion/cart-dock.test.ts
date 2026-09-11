import { describe, expect, it } from "vitest";
import { CAPSULE_BAG, CAPSULE_PAD, DOCK_GAP, capsuleWidth } from "./cart-dock";

describe("the bag capsule", () => {
  it("is as wide as its total needs, and no wider", () => {
    const small = capsuleWidth("A$6.20");
    const big = capsuleWidth("A$120.00");
    expect(big).toBeGreaterThan(small);
    expect(small).toBeGreaterThan(CAPSULE_PAD * 2 + CAPSULE_BAG);
    expect(small).toBeLessThan(140);
  });

  it("matches the App's arithmetic, digit for digit", () => {
    // 16 + 16 + 20 + 10 + ceil(6 × 8.4) = 113 for "A$6.20"
    expect(capsuleWidth("A$6.20")).toBe(113);
    expect(DOCK_GAP).toBe(10);
  });
});
