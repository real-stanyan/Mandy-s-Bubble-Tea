import { DELIVERY } from "./constants";

// Customer-facing delivery fee, distance-based (straight-line km from store):
//  1. Within the free radius (<= 3km): always free, regardless of subtotal.
//  2. Beyond 3km but subtotal >= $50: free.
//  3. Otherwise: the distance band fee (8–10km uses the flat fallback).
// Eligibility (minimum order) is enforced separately by `isDeliveryEligible`.
export function deliveryFeeCents(
  drinksSubtotalCents: bigint,
  distanceKm: number,
): bigint {
  if (distanceKm <= DELIVERY.freeRadiusKm) return 0n;
  if (drinksSubtotalCents >= DELIVERY.freeAtSubtotalCents) return 0n;
  const band = DELIVERY.tiers.find((t) => distanceKm <= t.maxKm);
  return band ? band.feeCents : DELIVERY.fallbackFeeCents;
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
