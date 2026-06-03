import { describe, it, expect } from "vitest";
import {
  deliveryFeeCents,
  serviceFeeCents,
  isDeliveryEligible,
} from "../delivery-fee";

describe("deliveryFeeCents — free radius + $50 free threshold", () => {
  // <= 3km straight-line: always free, regardless of subtotal.
  it("at store (0km): free even on a tiny order", () => {
    expect(deliveryFeeCents(800n, 0)).toBe(0n);
  });
  it("1.5km: free at $1.00", () => {
    expect(deliveryFeeCents(100n, 1.5)).toBe(0n);
  });
  it("exactly 3.0km: free (boundary is in the free radius)", () => {
    expect(deliveryFeeCents(4999n, 3)).toBe(0n);
  });

  // 3–4km band: $4.99, free at $50.
  it("just over 3km (3.01km): 499n below $50", () => {
    expect(deliveryFeeCents(4999n, 3.01)).toBe(499n);
  });
  it("3.01km: 0n at $50", () => {
    expect(deliveryFeeCents(5000n, 3.01)).toBe(0n);
  });
  it("exactly 4.0km → 3–4 band (499n)", () => {
    expect(deliveryFeeCents(4999n, 4)).toBe(499n);
  });

  // 4–6km band: $6.99, free at $50.
  it("5km: 699n below $50", () => {
    expect(deliveryFeeCents(4999n, 5)).toBe(699n);
  });
  it("5km: 0n at $50", () => {
    expect(deliveryFeeCents(5000n, 5)).toBe(0n);
  });

  // 6–8km band: $8.99, free at $50.
  it("7km: 899n below $50", () => {
    expect(deliveryFeeCents(4999n, 7)).toBe(899n);
  });
  it("exactly 8.0km → 6–8 band (899n), not fallback", () => {
    expect(deliveryFeeCents(4999n, 8)).toBe(899n);
  });

  // 8–10km fallback: $12, now ALSO free at $50 (all >3km free at $50).
  it("9km: 1200n below $50", () => {
    expect(deliveryFeeCents(4999n, 9)).toBe(1200n);
  });
  it("just over 8km (8.01km) → fallback (1200n)", () => {
    expect(deliveryFeeCents(4999n, 8.01)).toBe(1200n);
  });
  it("9km: 0n at $50 (fallback is no longer never-free)", () => {
    expect(deliveryFeeCents(5000n, 9)).toBe(0n);
  });

  // $50 free threshold applies across all paid bands.
  it("any paid band at $100 is free", () => {
    expect(deliveryFeeCents(10000n, 3.5)).toBe(0n);
    expect(deliveryFeeCents(10000n, 5)).toBe(0n);
    expect(deliveryFeeCents(10000n, 9)).toBe(0n);
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
