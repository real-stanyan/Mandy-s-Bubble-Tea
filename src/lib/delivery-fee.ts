import { DELIVERY } from "./constants";

// Customer-facing delivery fee, distance-based (straight-line km from store).
// Per-km bands (+$1 each km); each band carries its own free-delivery threshold:
//  • 0–4km : free at/above $35, else $3.99 / $4.99 / $5.99 (per km).
//  • 4–8km : free at/above $50, else $6.99 / $7.99 / $8.99 / $9.99 (per km).
//  • 8km+  : flat $15, never waived (no free threshold).
// Eligibility (minimum order) is enforced separately by `isDeliveryEligible`.
export function deliveryFeeCents(
  drinksSubtotalCents: bigint,
  distanceKm: number,
): bigint {
  const band = DELIVERY.tiers.find((t) => distanceKm <= t.maxKm);
  if (!band) return DELIVERY.farFeeCents;
  if (drinksSubtotalCents >= band.freeAtCents) return 0n;
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
