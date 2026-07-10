import { describe, it, expect } from "vitest";
import {
  deliveryFeeCents,
  paidDrinksSubtotalCents,
  serviceFeeCents,
  isDeliveryEligible,
} from "../delivery-fee";

describe("paidDrinksSubtotalCents — post-discount paid amount", () => {
  it("no discounts: paid equals the pre-discount subtotal", () => {
    expect(paidDrinksSubtotalCents(3560n, 0n)).toBe(3560n);
  });
  it("subtracts discounts: $35.60 − $9.00 = $26.60", () => {
    expect(paidDrinksSubtotalCents(3560n, 900n)).toBe(2660n);
  });
  it("clamps at 0n when discounts cover everything (full star redeem)", () => {
    expect(paidDrinksSubtotalCents(880n, 880n)).toBe(0n);
  });
  it("clamps at 0n when discounts exceed the subtotal", () => {
    expect(paidDrinksSubtotalCents(836n, 924n)).toBe(0n);
  });

  // Production regression fixture — order DE848 (2026-07-08, 3.70km):
  // pre-discount $35.60, Diamond free toppings $7.60 + Diamond 5% $1.40.
  // Old rule: fee computed on $35.60 ≥ $35 → FREE, svc 5% × $35.60 = $1.78.
  // New rule: paid $26.60 < $35 → band fee $5.99, svc 5% × $26.60 = $1.33.
  it("DE848: paid $26.60 at 3.70km → $5.99 fee (no longer free)", () => {
    const paid = paidDrinksSubtotalCents(3560n, 760n + 140n);
    expect(paid).toBe(2660n);
    expect(deliveryFeeCents(paid, 3.7)).toBe(599n);
    expect(serviceFeeCents(paid)).toBe(133n);
  });
  it("full star redeem still pays its band fee: paid $0 at 3.70km → $5.99", () => {
    const paid = paidDrinksSubtotalCents(880n, 880n);
    expect(deliveryFeeCents(paid, 3.7)).toBe(599n);
    expect(serviceFeeCents(paid)).toBe(0n);
  });
  it("undiscounted $36 order at 3.70km stays FREE (threshold unchanged)", () => {
    const paid = paidDrinksSubtotalCents(3600n, 0n);
    expect(deliveryFeeCents(paid, 3.7)).toBe(0n);
  });
});

describe("deliveryFeeCents — per-km bands, distance-banded free thresholds", () => {
  // 0–4km free zone: free at $35. Per-km fees 0–2 $3.99 / 2–3 $4.99 / 3–4 $5.99.
  // The old "always free within 3km" radius is GONE.
  it("at store (0km) on a tiny order: pays the 0–2km fee, no free radius", () => {
    expect(deliveryFeeCents(800n, 0)).toBe(399n);
  });
  it("2km, $20: 399n (0–2 band, below $35)", () => {
    expect(deliveryFeeCents(2000n, 2)).toBe(399n);
  });
  it("2km, $35: free", () => {
    expect(deliveryFeeCents(3500n, 2)).toBe(0n);
  });
  it("2.01km, $20: 499n (into 2–3 band)", () => {
    expect(deliveryFeeCents(2000n, 2.01)).toBe(499n);
  });
  it("3km, $34.99: 499n (2–3 band, just below $35)", () => {
    expect(deliveryFeeCents(3499n, 3)).toBe(499n);
  });
  it("3.01km, $20: 599n (into 3–4 band)", () => {
    expect(deliveryFeeCents(2000n, 3.01)).toBe(599n);
  });
  it("4km, $34.99: 599n (3–4 band, just below $35)", () => {
    expect(deliveryFeeCents(3499n, 4)).toBe(599n);
  });
  it("exactly 4.0km, $35: free", () => {
    expect(deliveryFeeCents(3500n, 4)).toBe(0n);
  });

  // 4–8km free zone: free at $50 (NOT $35). Per-km fees 4–5 $6.99 / 5–6 $7.99 /
  // 6–7 $8.99 / 7–8 $9.99.
  it("5km, $35: 699n (4–5 band, above $35 but below $50)", () => {
    expect(deliveryFeeCents(3500n, 5)).toBe(699n);
  });
  it("5km, $49.99: 699n", () => {
    expect(deliveryFeeCents(4999n, 5)).toBe(699n);
  });
  it("5km, $50: free", () => {
    expect(deliveryFeeCents(5000n, 5)).toBe(0n);
  });
  it("6km, $49.99: 799n (5–6 band)", () => {
    expect(deliveryFeeCents(4999n, 6)).toBe(799n);
  });
  it("7km, $49.99: 899n (6–7 band)", () => {
    expect(deliveryFeeCents(4999n, 7)).toBe(899n);
  });
  it("exactly 8.0km, $49.99: 999n (7–8 band)", () => {
    expect(deliveryFeeCents(4999n, 8)).toBe(999n);
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
