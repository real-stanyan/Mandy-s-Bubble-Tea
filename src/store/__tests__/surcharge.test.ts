import { describe, it, expect } from "vitest";
import { publicHolidaySurcharge, cardSurcharge } from "../cart";

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
});

describe("cardSurcharge sanity (baseline)", () => {
  it("computes 1.9% of the base", () => {
    // 1.9% of $6.20 = 0.1178 → 11 cents floor
    expect(cardSurcharge(620n)).toBe(11n);
  });
});
