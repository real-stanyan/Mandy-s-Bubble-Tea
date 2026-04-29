import { describe, it, expect } from "vitest";
import { publicHolidaySurcharge, cardSurcharge, platformFee } from "../cart";

describe("publicHolidaySurcharge", () => {
  it("computes 10% of the base in cents (BigInt)", () => {
    expect(publicHolidaySurcharge(620n)).toBe(62n);
    expect(publicHolidaySurcharge(1240n)).toBe(124n);
    expect(publicHolidaySurcharge(0n)).toBe(0n);
  });

  it("floors for uneven divisions", () => {
    // 10% of $1.23 = 0.123 → 12 cents (BigInt integer division truncates)
    expect(publicHolidaySurcharge(123n)).toBe(12n);
  });

  it("clamps negative inputs to 0 (mirrors cardSurcharge)", () => {
    expect(publicHolidaySurcharge(-1n)).toBe(0n);
    expect(publicHolidaySurcharge(-1000n)).toBe(0n);
  });
});

describe("cardSurcharge sanity (baseline)", () => {
  it("computes 1.9% of the base", () => {
    // 1.9% of $6.20 = 0.1178 → 11 cents floor
    expect(cardSurcharge(620n)).toBe(11n);
  });
});

describe("platformFee", () => {
  it("computes 0.4% of the base in cents (BigInt)", () => {
    // 0.4% of $6.20 = 0.0248 → floor 2 cents
    expect(platformFee(620n)).toBe(2n);
    // 0.4% of $12.40 = 0.0496 → floor 4 cents
    expect(platformFee(1240n)).toBe(4n);
    expect(platformFee(0n)).toBe(0n);
  });

  it("floors for uneven divisions", () => {
    // 0.4% of $1.25 = 0.005 → floor 0 cents (Square server may round to 1; ≤1c divergence is OK)
    expect(platformFee(125n)).toBe(0n);
  });

  it("clamps negative inputs to 0 (mirrors cardSurcharge)", () => {
    expect(platformFee(-1n)).toBe(0n);
    expect(platformFee(-1000n)).toBe(0n);
  });

  it("computes large-amount math without overflow", () => {
    // 0.4% of $10,000.00 = $40.00
    expect(platformFee(1_000_000n)).toBe(4_000n);
  });
});
