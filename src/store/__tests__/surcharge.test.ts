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
  it("computes 0.5% of the base in cents (BigInt)", () => {
    // 0.5% of $6.20 = 0.031 → floor 3 cents
    expect(platformFee(620n)).toBe(3n);
    // 0.5% of $12.40 = 0.062 → floor 6 cents
    expect(platformFee(1240n)).toBe(6n);
    expect(platformFee(0n)).toBe(0n);
  });

  it("floors for uneven divisions", () => {
    // 0.5% of $1.25 = 0.00625 → floor 0 cents (Square server may round to 1; ≤1c divergence is OK)
    expect(platformFee(125n)).toBe(0n);
  });

  it("clamps negative inputs to 0 (mirrors cardSurcharge)", () => {
    expect(platformFee(-1n)).toBe(0n);
    expect(platformFee(-1000n)).toBe(0n);
  });

  it("computes large-amount math without overflow", () => {
    // 0.5% of $10,000.00 = $50.00
    expect(platformFee(1_000_000n)).toBe(5_000n);
  });
});
