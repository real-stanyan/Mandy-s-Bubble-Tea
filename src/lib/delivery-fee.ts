import { DELIVERY } from "./constants";

// Customer-facing delivery fee, distance-based. The fee depends on how far the
// delivery address is from the store (straight-line km). Each band has its own
// fee and its own free-delivery threshold: below that subtotal the band fee
// applies, at or above it delivery is free. Addresses beyond the last band but
// still within the delivery radius pay a flat fallback fee that is never free.
// Eligibility (minimum order) is enforced separately by `isDeliveryEligible`.
export function deliveryFeeCents(
  drinksSubtotalCents: bigint,
  distanceKm: number,
): bigint {
  const band = DELIVERY.tiers.find((t) => distanceKm <= t.maxKm);
  if (!band) return DELIVERY.fallbackFeeCents;
  if (drinksSubtotalCents >= band.freeAtSubtotalCents) return 0n;
  return band.feeCents;
}

// 5% Service Fee on drinks subtotal. Charged on every delivery order, including
// those that qualify for FREE delivery — it partially offsets the cost of
// self-delivery (staff time + petrol). Truncates to whole cents.
export function serviceFeeCents(drinksSubtotalCents: bigint): bigint {
  if (drinksSubtotalCents <= 0n) return 0n;
  return (drinksSubtotalCents * DELIVERY.serviceFeeBps) / 10000n;
}

export function isDeliveryEligible(drinksSubtotalCents: bigint): boolean {
  return drinksSubtotalCents >= DELIVERY.minimumSubtotalCents;
}
