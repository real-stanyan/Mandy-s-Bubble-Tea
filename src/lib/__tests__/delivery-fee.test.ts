import { describe, it, expect } from "vitest";
import {
  deliveryFeeCents,
  serviceFeeCents,
  isDeliveryEligible,
} from "../delivery-fee";

describe("deliveryFeeCents", () => {
  it("returns 499n at subtotal $18.00 (minimum)", () => {
    expect(deliveryFeeCents(1800n)).toBe(499n);
  });

  it("returns 499n at subtotal $34.99", () => {
    expect(deliveryFeeCents(3499n)).toBe(499n);
  });

  it("returns 0n (FREE) at subtotal $35.00", () => {
    expect(deliveryFeeCents(3500n)).toBe(0n);
  });

  it("returns 0n at subtotal far above threshold", () => {
    expect(deliveryFeeCents(10000n)).toBe(0n);
  });

  it("returns 499n even below minimum (caller enforces eligibility separately)", () => {
    expect(deliveryFeeCents(0n)).toBe(499n);
  });
});

describe("serviceFeeCents", () => {
  it("returns 8% of $20.00 = $1.60", () => {
    expect(serviceFeeCents(2000n)).toBe(160n);
  });

  it("returns 8% of $35.00 = $2.80 (still charged at free-delivery tier)", () => {
    expect(serviceFeeCents(3500n)).toBe(280n);
  });

  it("returns 0n on $0 subtotal", () => {
    expect(serviceFeeCents(0n)).toBe(0n);
  });

  it("returns 0n on negative subtotal (defensive)", () => {
    expect(serviceFeeCents(-100n)).toBe(0n);
  });

  it("truncates fractional cents (8% of $18.00 = $1.44 exact)", () => {
    expect(serviceFeeCents(1800n)).toBe(144n);
  });

  it("truncates 8% of $25.13 = $2.0104 → 201n", () => {
    expect(serviceFeeCents(2513n)).toBe(201n);
  });
});

describe("isDeliveryEligible", () => {
  it("false at subtotal $17.99", () => {
    expect(isDeliveryEligible(1799n)).toBe(false);
  });

  it("true at subtotal $18.00", () => {
    expect(isDeliveryEligible(1800n)).toBe(true);
  });

  it("true at subtotal $100.00", () => {
    expect(isDeliveryEligible(10000n)).toBe(true);
  });
});
