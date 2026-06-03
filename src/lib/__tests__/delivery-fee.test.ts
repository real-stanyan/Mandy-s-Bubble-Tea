import { describe, it, expect } from "vitest";
import {
  deliveryFeeCents,
  serviceFeeCents,
  isDeliveryEligible,
} from "../delivery-fee";

describe("deliveryFeeCents — distance-banded free thresholds", () => {
  // 0–4km band: $4.99, free at $35. The old "always free within 3km"
  // radius is GONE — a small order close to the store now pays the band fee.
  it("at store (0km) on a tiny order: pays the 0–4km fee, no free radius", () => {
    expect(deliveryFeeCents(800n, 0)).toBe(499n);
  });
  it("2km, $20: 499n (below $35)", () => {
    expect(deliveryFeeCents(2000n, 2)).toBe(499n);
  });
  it("2km, $35: free", () => {
    expect(deliveryFeeCents(3500n, 2)).toBe(0n);
  });
  it("4km, $34.99: 499n (just below $35)", () => {
    expect(deliveryFeeCents(3499n, 4)).toBe(499n);
  });
  it("exactly 4.0km, $35: free", () => {
    expect(deliveryFeeCents(3500n, 4)).toBe(0n);
  });

  // 4–6km band: $6.99, free at $50 (NOT $35).
  it("5km, $35: 699n (above $35 but below $50)", () => {
    expect(deliveryFeeCents(3500n, 5)).toBe(699n);
  });
  it("5km, $49.99: 699n", () => {
    expect(deliveryFeeCents(4999n, 5)).toBe(699n);
  });
  it("5km, $50: free", () => {
    expect(deliveryFeeCents(5000n, 5)).toBe(0n);
  });

  // 6–8km band: $8.99, free at $50.
  it("7km, $49.99: 899n", () => {
    expect(deliveryFeeCents(4999n, 7)).toBe(899n);
  });
  it("exactly 8.0km, $49.99: 899n (boundary stays in 6–8 band)", () => {
    expect(deliveryFeeCents(4999n, 8)).toBe(899n);
  });
  it("8km, $50: free", () => {
    expect(deliveryFeeCents(5000n, 8)).toBe(0n);
  });

  // 8km+ : flat $15, NEVER free regardless of subtotal.
  it("just over 8km (8.01km), $20: flat 1500n", () => {
    expect(deliveryFeeCents(2000n, 8.01)).toBe(1500n);
  });
  it("9km, $100: still 1500n (flat, never free)", () => {
    expect(deliveryFeeCents(10000n, 9)).toBe(1500n);
  });
  it("12km, $200: still 1500n", () => {
    expect(deliveryFeeCents(20000n, 12)).toBe(1500n);
  });
});

describe("serviceFeeCents — 5%", () => {
  it("5% of $20.00 = $1.00", () => {
    expect(serviceFeeCents(2000n)).toBe(100n);
  });
  it("5% of $50.00 = $2.50 (charged even at free-delivery tier)", () => {
    expect(serviceFeeCents(5000n)).toBe(250n);
  });
  it("0n on $0 subtotal", () => {
    expect(serviceFeeCents(0n)).toBe(0n);
  });
  it("0n on negative subtotal (defensive)", () => {
    expect(serviceFeeCents(-100n)).toBe(0n);
  });
  it("truncates: 5% of $25.13 = $1.2565 → 125n", () => {
    expect(serviceFeeCents(2513n)).toBe(125n);
  });
});

describe("isDeliveryEligible — $12 minimum", () => {
  it("false at $11.99", () => {
    expect(isDeliveryEligible(1199n)).toBe(false);
  });
  it("true at $12.00", () => {
    expect(isDeliveryEligible(1200n)).toBe(true);
  });
  it("true at $100.00", () => {
    expect(isDeliveryEligible(10000n)).toBe(true);
  });
});
