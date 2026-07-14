import {
  DELIVERY,
  PLATFORM_FEE_BPS,
  CARD_SURCHARGE_BPS,
  PH_SURCHARGE_BPS,
} from "./constants";

// Subtotal the free-delivery threshold is measured against. The waiver isn't
// judged on the bare paid drinks but on what the customer actually pays at
// SUBTOTAL_PHASE: the post-discount paid drinks (see paidDrinksSubtotalCents)
// plus the surcharges that will be charged. The 5% service fee is charged on
// every delivery order (including star-redeem); the platform (0.5%), card
// (1.9%) and public-holiday (10%) surcharges are skipped on redeem orders, so
// they only count when `orderSurcharges` is set. Each surcharge truncates to
// whole cents, mirroring how the individual charges are computed.
// `deliveryFeeCents` compares this to a band's `freeAtCents`; the distance band
// itself is unaffected.
export function freeDeliverySubtotalCents(
  paidDrinksCents: bigint,
  opts?: { orderSurcharges?: boolean; publicHoliday?: boolean },
): bigint {
  if (paidDrinksCents <= 0n) return 0n;
  const withOrderSurcharges = opts?.orderSurcharges ?? true;
  let surcharges = (paidDrinksCents * DELIVERY.serviceFeeBps) / 10000n;
  if (withOrderSurcharges) {
    surcharges +=
      (paidDrinksCents * PLATFORM_FEE_BPS) / 10000n +
      (paidDrinksCents * CARD_SURCHARGE_BPS) / 10000n +
      (opts?.publicHoliday
        ? (paidDrinksCents * PH_SURCHARGE_BPS) / 10000n
        : 0n);
  }
  return paidDrinksCents + surcharges;
}

// What the customer actually pays for drinks: the pre-discount drinks subtotal
// minus every discount (welcome/IG/tier 5%/free toppings + loyalty-reward
// cups), clamped at $0. Since 2026-07-10 the delivery fee, its free-delivery
// thresholds, and the 5% service fee are all computed on THIS value — a
// discounted order can no longer reach the free threshold on sticker prices,
// and a star-redeemed drink still pays for its own delivery.
// Eligibility ($12 minimum) intentionally stays on the PRE-discount subtotal
// so a redeemed drink can still be delivered at all.
export function paidDrinksSubtotalCents(
  drinksSubtotalCents: bigint,
  discountTotalCents: bigint,
): bigint {
  const paid = drinksSubtotalCents - discountTotalCents;
  return paid > 0n ? paid : 0n;
}

// Customer-facing delivery fee, distance-based (straight-line km from store).
// Per-km bands (+$1 each km); each band carries its own free-delivery threshold:
//  • 0–4km : free at/above $35, else $3.99 / $4.99 / $5.99 (per km).
//  • 4–8km : free at/above $50, else $6.99 / $7.99 / $8.99 / $9.99 (per km).
//  • 8km+  : flat $15, never waived (no free threshold).
// The subtotal argument is the POST-discount paid amount (see
// `paidDrinksSubtotalCents`). Eligibility (minimum order) is enforced
// separately by `isDeliveryEligible` on the pre-discount subtotal.
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
