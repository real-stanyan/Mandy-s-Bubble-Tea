import { DELIVERY } from "./constants";

// Customer-facing delivery fee. Below the free-delivery threshold the
// customer pays a flat $4.99; at or above $35.00 drinks subtotal,
// delivery is free. Eligibility (minimum order) is enforced separately
// by `isDeliveryEligible` — this helper returns the fee unconditionally
// so the UI can preview "you'd pay $4.99" copy on under-minimum carts.
export function deliveryFeeCents(drinksSubtotalCents: bigint): bigint {
  if (drinksSubtotalCents >= DELIVERY.feeFreeAtSubtotalCents) return 0n;
  return DELIVERY.feeCents;
}

// 8% Service Fee on drinks subtotal. Charged on every delivery order,
// including those that qualify for FREE delivery — the Service Fee
// partially offsets the cost of self-delivery (staff time + petrol).
// Truncates to whole cents.
export function serviceFeeCents(drinksSubtotalCents: bigint): bigint {
  if (drinksSubtotalCents <= 0n) return 0n;
  return (drinksSubtotalCents * DELIVERY.serviceFeeBps) / 10000n;
}

export function isDeliveryEligible(drinksSubtotalCents: bigint): boolean {
  return drinksSubtotalCents >= DELIVERY.minimumSubtotalCents;
}
