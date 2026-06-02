import { describe, it, expect } from "vitest";
import {
  deliveryFeeCents,
  serviceFeeCents,
  isDeliveryEligible,
} from "../delivery-fee";

describe("deliveryFeeCents — distance bands", () => {
  // band 0–2km: $3.99, free over $35
  it("0–2km: 399n below free threshold", () => {
    expect(deliveryFeeCents(3499n, 1.5)).toBe(399n);
  });
  it("0–2km: 0n at/above $35 free threshold", () => {
    expect(deliveryFeeCents(3500n, 1.5)).toBe(0n);
  });
  it("0km (at store) uses first band", () => {
    expect(deliveryFeeCents(2000n, 0)).toBe(399n);
  });

  // band 2–4km: $4.99, free over $35
  it("2–4km: 499n below free threshold", () => {
    expect(deliveryFeeCents(3499n, 3)).toBe(499n);
  });
  it("2–4km: 0n at $35", () => {
    expect(deliveryFeeCents(3500n, 3)).toBe(0n);
  });

  // band 4–6km: $6.99, free over $50
  it("4–6km: 699n below $50", () => {
    expect(deliveryFeeCents(4999n, 5)).toBe(699n);
  });
  it("4–6km: still 699n at $35 (threshold is $50 here)", () => {
    expect(deliveryFeeCents(3500n, 5)).toBe(699n);
  });
  it("4–6km: 0n at $50", () => {
    expect(deliveryFeeCents(5000n, 5)).toBe(0n);
  });

  // band 6–8km: $8.99, free over $50
  it("6–8km: 899n below $50", () => {
    expect(deliveryFeeCents(4999n, 7)).toBe(899n);
  });
  it("6–8km: 0n at $50", () => {
    expect(deliveryFeeCents(5000n, 7)).toBe(0n);
  });

  // fallback 8–10km: $12, never free
  it("8–10km fallback: 1200n below $50", () => {
    expect(deliveryFeeCents(4999n, 9)).toBe(1200n);
  });
  it("8–10km fallback: still 1200n even at $100 (never free)", () => {
    expect(deliveryFeeCents(10000n, 9)).toBe(1200n);
  });

  // boundaries: <= puts exact boundary in the lower band
  it("exactly 2.0km → 0–2 band (399n)", () => {
    expect(deliveryFeeCents(2000n, 2)).toBe(399n);
  });
  it("exactly 8.0km → 6–8 band (899n), not fallback", () => {
    expect(deliveryFeeCents(4999n, 8)).toBe(899n);
  });
  it("just over 8km (8.01km) → fallback (1200n)", () => {
    expect(deliveryFeeCents(4999n, 8.01)).toBe(1200n);
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
