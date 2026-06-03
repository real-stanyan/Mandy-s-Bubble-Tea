import { describe, it, expect } from "vitest";
import { welcomeDiscountEligible } from "../promo-eligibility";

describe("welcomeDiscountEligible", () => {
  it("allows the welcome discount on PICKUP orders", () => {
    expect(welcomeDiscountEligible("PICKUP")).toBe(true);
  });
  it("blocks the welcome discount on DELIVERY orders", () => {
    expect(welcomeDiscountEligible("DELIVERY")).toBe(false);
  });
});
