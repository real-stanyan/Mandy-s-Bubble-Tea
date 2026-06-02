# Distance-Based Delivery Fees — Design

**Date:** 2026-06-02
**Status:** Approved (brainstorm)
**Author:** /dev (Stan)

## Problem

The custom site's delivery pricing is a single flat fee ($4.99, free over $35,
$18 minimum, 8% service fee) hardcoded in `src/lib/constants.ts`. Stan configured
**distance-based fees** in the Square Online dashboard and wants the custom site to
adopt that exact rule set.

Square's delivery config is **not readable via any public API** (Square Online
store settings are dashboard-only; the Orders API is order-level, not config-level —
verified 2026-06-02). So the rules must be transcribed into our own `constants.ts`,
which remains the single source of truth for the custom site (`mandybubbletea.com`).
The Square dashboard values only govern Square Online, which the custom site does
not use.

## The Rules (transcribed from Square Online dashboard)

| Distance band | Delivery fee | Free over (drinks subtotal) |
|---------------|--------------|------------------------------|
| 0–2 km        | $3.99        | $35 |
| 2–4 km        | $4.99        | $35 |
| 4–6 km        | $6.99        | $50 |
| 6–8 km        | $8.99        | $50 |
| 8–10 km (fallback) | **$12.00** | never free (always charged) |
| > 10 km       | not deliverable (`out_of_zone`) | — |

- **Service Fee:** 8% → **5%** of drinks subtotal, charged on every delivery order
  (including free-delivery orders).
- **Minimum order:** $18 → **$12** (drinks subtotal).
- **Radius:** 10 km (unchanged), great-circle / straight-line distance (matches
  Square's "Radius uses straight line distance").
- **Delivery hours:** 11:00–21:30 → **10:30–22:30**, all 7 days, Australia/Brisbane.

### Decisions

- **8–10 km behavior:** match Square exactly — still deliverable up to 10 km radius,
  charged the $12 fallback fee. Distance bands explicitly cover 0–8 km; anything
  beyond the last band but within `maxKm` falls back to $12.
- **Scope:** pricing + radius + hours only. The Square page's scheduling machinery
  (estimated delivery time, future-day scheduling, prep time, order rate-limiting,
  ticket-print timing) is **out of scope** — the self-delivery site has none of that
  infrastructure and building it is a separate project.
- **Fee/free-threshold base:** drinks subtotal (pre-tax, pre-fee), preserving the
  existing convention and matching Square's "order total before coupons, taxes,
  delivery, or other fees."

## Architecture

The change is contained to the existing delivery layer. No new modules.

### 1. Data model — `src/lib/constants.ts`

Replace the flat `DELIVERY` shape with a tier table:

```ts
export const DELIVERY = {
  // Distance bands, ascending. First band whose maxKm >= distance wins.
  tiers: [
    { maxKm: 2, feeCents: 399n, freeAtSubtotalCents: 3500n },
    { maxKm: 4, feeCents: 499n, freeAtSubtotalCents: 3500n },
    { maxKm: 6, feeCents: 699n, freeAtSubtotalCents: 5000n },
    { maxKm: 8, feeCents: 899n, freeAtSubtotalCents: 5000n },
  ],
  fallbackFeeCents: 1200n,        // beyond last tier, within maxKm — always charged
  maxKm: 10,                      // delivery radius (straight-line km)
  minimumSubtotalCents: 1200n,    // $12 minimum order
  serviceFeeBps: 500n,            // 5% of drinks subtotal
  hoursOpen: 10.5,                // 10:30 Brisbane
  hoursClose: 22.5,               // 22:30 Brisbane
} as const;
```

`SERVICE_FEE.percentage` string updates "8" → "5". `DELIVERY_FEE_NAME` unchanged.
`STORE_LAT/STORE_LNG` unchanged (still carries the pre-existing "confirm with
Google Maps" TODO — out of scope here).

### 2. Fee logic — `src/lib/delivery-fee.ts`

`deliveryFeeCents` changes signature to take distance:

```ts
deliveryFeeCents(drinksSubtotalCents: bigint, distanceKm: number): bigint
  - find first tier where distanceKm <= tier.maxKm
    - hit:  drinksSubtotal >= tier.freeAtSubtotalCents ? 0n : tier.feeCents
    - miss (distance > last tier maxKm, still within radius): fallbackFeeCents
```

`serviceFeeCents(drinksSubtotalCents)` — unchanged logic, picks up `serviceFeeBps`
500 automatically. `isDeliveryEligible(drinksSubtotalCents)` — unchanged logic,
picks up `minimumSubtotalCents` 1200 automatically.

`isWithinDeliveryRadius` in `places.ts` is unchanged (still `<= maxKm` = 10).

### 3. Fee call sites both pass distance

The fee is computed in two places, both of which already have the customer's
lat/lng. Both must compute the fee server-side from distance — the client value
is never trusted.

- `src/app/api/delivery/quote/route.ts`: compute
  `distanceKm(STORE_COORDS, { lat, lng })` and pass to `deliveryFeeCents`.
- `src/app/api/orders/route.ts` (~line 485): compute the same distance from
  `body.delivery.lat/lng` and pass to `deliveryFeeCents`. This is the
  authoritative charge.

### 4. UX — `src/components/checkout/FulfillmentSelector.tsx`

Before an address is entered the exact fee is unknown (it depends on distance).
The preview copy changes from `FREE over $35` to `By our team · from $3.99`
(the cheapest band). The min-order gating message (`Add $X to enable`) updates
automatically from `minimumSubtotalCents`. `DeliveryQuoteCard` already renders the
quoted fee returned by `/api/delivery/quote`; no structural change.

### 5. Tests

- Rewrite `src/lib/__tests__/delivery-fee.test.ts`: each band's fee, band
  boundaries (e.g. exactly 2.0 km), the fallback band (8–10 km), per-band free
  thresholds ($35 vs $50), service fee at 5%, eligibility at the $12 minimum.
- `src/lib/__tests__/places.test.ts`: radius is still 10 km — verify existing
  tests still pass; add a case for an 8–10 km point being in-radius.

## Data flow

```
checkout → address (Google Places → lat/lng)
  → POST /api/delivery/quote
       distanceKm(store, dest)
       isWithinDeliveryRadius? isDeliveryEligible? isDeliveryHoursOpen?
       deliveryFeeCents(subtotal, distance) + serviceFeeCents(subtotal)
  → DeliveryQuoteCard shows fee
  → POST /api/orders (and payment)
       recompute distanceKm server-side → deliveryFeeCents(subtotal, distance)
       → Square order line items (Delivery Fee + Service Fee)
```

## Error handling / edge cases

- distance exactly on a band boundary (2.0, 4.0, 6.0, 8.0 km): first-match
  `<=` puts it in the lower band. Negligible real-world impact (haversine).
- distance > 8 km and <= 10 km: fallback $12, never free.
- distance > 10 km: rejected by `isWithinDeliveryRadius` before fee math runs
  (`out_of_zone`).
- subtotal below $12: `isDeliveryEligible` false → `min_order`, no fee shown.

## Out of scope

- Reading any config live from Square (no API exists).
- Scheduling / future-day orders / prep time / rate-limiting / ticket-print timing.
- Customer RN app delivery (web only this round).
- Confirming exact store lat/lng via Google Maps (pre-existing TODO).

## Rollout

Direct to `main` (per Stan): TDD implement → tests green + tsc clean → commit to
main → GitHub auto-deploy. Delivery flag already `NEXT_PUBLIC_DELIVERY_ENABLED=true`
in production, so the new pricing goes live on deploy.
