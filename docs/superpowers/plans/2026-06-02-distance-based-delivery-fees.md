# Distance-Based Delivery Fees Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the custom site's flat delivery fee with Square's distance-based fee table (4 bands + $12 fallback), drop service fee 8%→5% and minimum $18→$12, and widen hours to 10:30–22:30.

**Architecture:** All changes live in the existing delivery layer. `constants.ts` gains a `DELIVERY.tiers` table; `deliveryFeeCents` takes a `distanceKm` argument; the two fee call sites (`/api/delivery/quote`, `/api/orders`) compute distance server-side from the customer's lat/lng (already present) and pass it in; the checkout fulfillment toggle's preview copy changes since the exact fee is now distance-dependent.

**Tech Stack:** Next.js (App Router), TypeScript, BigInt money, vitest.

**Spec:** `docs/superpowers/specs/2026-06-02-distance-based-delivery-fees-design.md`

---

## File Structure

- Modify: `src/lib/constants.ts` — `DELIVERY` shape → tier table; `SERVICE_FEE.percentage` "8"→"5".
- Modify: `src/lib/delivery-fee.ts` — `deliveryFeeCents(subtotal, distanceKm)`; comments updated.
- Modify: `src/app/api/delivery/quote/route.ts` — compute distance, pass to fee.
- Modify: `src/app/api/orders/route.ts` — compute distance, pass to fee (authoritative charge).
- Modify: `src/components/checkout/FulfillmentSelector.tsx` — preview copy.
- Test: `src/lib/__tests__/delivery-fee.test.ts` — rewritten.
- Test: `src/lib/__tests__/places.test.ts` — add one in-radius fallback-band case.

---

### Task 1: Distance-based fee core (constants + delivery-fee + call sites)

This is one cohesive change — the `deliveryFeeCents` signature change ripples to every consumer, so all files must change together for the project to compile. TDD on the pure fee logic; mechanical edits on the call sites.

**Files:**
- Modify: `src/lib/constants.ts:107-118`
- Modify: `src/lib/delivery-fee.ts` (whole file)
- Modify: `src/app/api/delivery/quote/route.ts:2` (import) and the return block
- Modify: `src/app/api/orders/route.ts:17` (import) and `:485`
- Modify: `src/components/checkout/FulfillmentSelector.tsx` (preview copy)
- Test: `src/lib/__tests__/delivery-fee.test.ts` (whole file)

- [ ] **Step 1: Rewrite the failing test file**

Replace the entire contents of `src/lib/__tests__/delivery-fee.test.ts` with:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/__tests__/delivery-fee.test.ts`
Expected: FAIL — `deliveryFeeCents` still takes one argument and uses the old flat fee; band/fallback/5%/$12 cases all fail (and/or a type error on the 2-arg call).

- [ ] **Step 3: Update the `DELIVERY` constant + `SERVICE_FEE`**

In `src/lib/constants.ts`, replace the block (currently lines ~107-118):

```ts
export const DELIVERY = {
  feeCents: 499n,
  feeFreeAtSubtotalCents: 3500n,
  minimumSubtotalCents: 1800n,
  serviceFeeBps: 800n,           // 8% × drinks subtotal
  maxKm: 10,
  hoursOpen: 11,                 // 11:00 Brisbane
  hoursClose: 21.5,              // 21:30 Brisbane (decimal hour)
} as const;

export const SERVICE_FEE = {
  name: "Service Fee",
  percentage: "8",
} as const;
```

with:

```ts
export const DELIVERY = {
  // Distance bands, ascending. First band whose maxKm >= distance wins.
  // Transcribed from the Square Online dashboard (2026-06-02). Square's
  // settings are dashboard-only (no API), so this is the source of truth.
  tiers: [
    { maxKm: 2, feeCents: 399n, freeAtSubtotalCents: 3500n },
    { maxKm: 4, feeCents: 499n, freeAtSubtotalCents: 3500n },
    { maxKm: 6, feeCents: 699n, freeAtSubtotalCents: 5000n },
    { maxKm: 8, feeCents: 899n, freeAtSubtotalCents: 5000n },
  ],
  fallbackFeeCents: 1200n,        // 8–10km, beyond last band — always charged
  maxKm: 10,                      // delivery radius (straight-line km)
  minimumSubtotalCents: 1200n,    // $12 minimum order
  serviceFeeBps: 500n,            // 5% × drinks subtotal
  hoursOpen: 10.5,                // 10:30 Brisbane
  hoursClose: 22.5,               // 22:30 Brisbane (decimal hour)
} as const;

export const SERVICE_FEE = {
  name: "Service Fee",
  percentage: "5",
} as const;
```

- [ ] **Step 4: Rewrite `delivery-fee.ts`**

Replace the entire contents of `src/lib/delivery-fee.ts` with:

```ts
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/lib/__tests__/delivery-fee.test.ts`
Expected: PASS — all band, fallback, boundary, 5% service, and $12 eligibility cases green.

- [ ] **Step 6: Wire distance into the quote route**

In `src/app/api/delivery/quote/route.ts`, change the places import (line 2):

```ts
import { isWithinDeliveryRadius, STORE_COORDS } from "@/lib/places";
```
to:
```ts
import { distanceKm, isWithinDeliveryRadius, STORE_COORDS } from "@/lib/places";
```

Then replace the radius check + return block at the end of `POST`:

```ts
  if (!isWithinDeliveryRadius(STORE_COORDS, { lat: body.lat, lng: body.lng })) {
    return NextResponse.json({ ok: false, reason: "out_of_zone" });
  }

  return NextResponse.json({
    ok: true,
    feeCents: Number(deliveryFeeCents(drinksSubtotalCents)),
    serviceFeeCents: Number(serviceFeeCents(drinksSubtotalCents)),
  });
```
with:
```ts
  const dest = { lat: body.lat, lng: body.lng };
  if (!isWithinDeliveryRadius(STORE_COORDS, dest)) {
    return NextResponse.json({ ok: false, reason: "out_of_zone" });
  }

  const distKm = distanceKm(STORE_COORDS, dest);
  return NextResponse.json({
    ok: true,
    feeCents: Number(deliveryFeeCents(drinksSubtotalCents, distKm)),
    serviceFeeCents: Number(serviceFeeCents(drinksSubtotalCents)),
  });
```

- [ ] **Step 7: Wire distance into the orders route (authoritative charge)**

In `src/app/api/orders/route.ts`, change the places import (line 17):

```ts
import { isWithinDeliveryRadius, STORE_COORDS } from "@/lib/places";
```
to:
```ts
import { distanceKm, isWithinDeliveryRadius, STORE_COORDS } from "@/lib/places";
```

Then replace `const fee = deliveryFeeCents(drinksSubtotalCents);` (line ~485) with:

```ts
      const distKm = distanceKm(STORE_COORDS, {
        lat: body.delivery.lat,
        lng: body.delivery.lng,
      });
      const fee = deliveryFeeCents(drinksSubtotalCents, distKm);
```

(`body.delivery` is non-null in this `isDelivery` branch — it is validated when `fulfillmentType === "DELIVERY"` and already dereferenced above at the fulfillment-note build.)

- [ ] **Step 8: Update the fulfillment selector preview copy**

In `src/components/checkout/FulfillmentSelector.tsx`, the preview references the now-removed `DELIVERY.feeFreeAtSubtotalCents`. Replace:

```tsx
          {eligible
            ? `By our team · FREE over $${(Number(DELIVERY.feeFreeAtSubtotalCents) / 100).toFixed(0)}`
            : `Add ${formatPrice(remainingCents)} to enable`}
```
with:
```tsx
          {eligible
            ? `By our team · from $${(Number(DELIVERY.tiers[0].feeCents) / 100).toFixed(2)}`
            : `Add ${formatPrice(remainingCents)} to enable`}
```

- [ ] **Step 9: Update the delivery-hours test for the new 10:30–22:30 window**

The hours change (open 11→10:30, close 21:30→22:30) breaks the hardcoded
boundary cases in `src/lib/__tests__/delivery-hours.test.ts`. Replace its entire
contents with:

```ts
import { describe, it, expect } from "vitest";
import { isDeliveryHoursOpen } from "../delivery-hours";

// Helper: build a Date from Brisbane wall-clock (UTC+10).
function brisbane(ymd: string, hh = 12, mm = 0): Date {
  return new Date(`${ymd}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+10:00`);
}

describe("isDeliveryHoursOpen", () => {
  it("false at 10:29 Brisbane (before open)", () => {
    expect(isDeliveryHoursOpen(brisbane("2026-04-26", 10, 29))).toBe(false);
  });

  it("true at 10:30 Brisbane (open boundary)", () => {
    expect(isDeliveryHoursOpen(brisbane("2026-04-26", 10, 30))).toBe(true);
  });

  it("true at 22:29 Brisbane (just before close)", () => {
    expect(isDeliveryHoursOpen(brisbane("2026-04-26", 22, 29))).toBe(true);
  });

  it("false at 22:30 Brisbane (close boundary, exclusive)", () => {
    expect(isDeliveryHoursOpen(brisbane("2026-04-26", 22, 30))).toBe(false);
  });

  it("false at 22:31 Brisbane", () => {
    expect(isDeliveryHoursOpen(brisbane("2026-04-26", 22, 31))).toBe(false);
  });

  it("handles UTC-day-boundary: Brisbane 11:00 = UTC 01:00", () => {
    const utc = new Date("2026-04-26T01:00:00Z");
    expect(isDeliveryHoursOpen(utc)).toBe(true);
  });

  it("late-night UTC = Brisbane past close: 13:00 UTC = 23:00 Brisbane", () => {
    // 23:00 Brisbane is past the 22:30 close
    const utc = new Date("2026-04-26T13:00:00Z");
    expect(isDeliveryHoursOpen(utc)).toBe(false);
  });
});
```

- [ ] **Step 10: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: no new errors in `src/lib/delivery-fee.ts`, `src/lib/constants.ts`, `src/app/api/delivery/quote/route.ts`, `src/app/api/orders/route.ts`, `src/components/checkout/FulfillmentSelector.tsx`. (Pre-existing unrelated errors in `scripts/` / `tests/` may remain — note them, do not fix here.)

- [ ] **Step 11: Run the full delivery test suite**

Run: `npx vitest run src/lib/__tests__/delivery-fee.test.ts src/lib/__tests__/places.test.ts src/lib/__tests__/delivery-hours.test.ts`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add src/lib/constants.ts src/lib/delivery-fee.ts \
  src/app/api/delivery/quote/route.ts src/app/api/orders/route.ts \
  src/components/checkout/FulfillmentSelector.tsx \
  src/lib/__tests__/delivery-fee.test.ts \
  src/lib/__tests__/delivery-hours.test.ts
git commit -m "feat(delivery): distance-based fees matching Square dashboard

4 distance bands (0-8km) + \$12 fallback (8-10km), service fee 8%->5%,
minimum \$18->\$12, hours 10:30-22:30. deliveryFeeCents now takes distance;
quote + orders routes compute it server-side from the customer lat/lng.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Radius regression test + browser verification

**Files:**
- Test: `src/lib/__tests__/places.test.ts`

- [ ] **Step 1: Add a fallback-band in-radius case**

In `src/lib/__tests__/places.test.ts`, inside the `describe("isWithinDeliveryRadius", ...)` block, add:

```ts
  it("true at ~9 km (8–10km fallback band still in radius)", () => {
    expect(isWithinDeliveryRadius(STORE, { lat: STORE.lat + 0.081, lng: STORE.lng })).toBe(true);
  });
```

- [ ] **Step 2: Run the places test**

Run: `npx vitest run src/lib/__tests__/places.test.ts`
Expected: PASS (radius unchanged at 10 km; the ~9 km point is in-radius).

- [ ] **Step 3: Commit**

```bash
git add src/lib/__tests__/places.test.ts
git commit -m "test(delivery): assert 8-10km fallback band is in radius

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Browser smoke (cmux)**

Start the dev server (`npm run dev`, background, port 3000) with `NEXT_PUBLIC_DELIVERY_ENABLED=true`. Open/refresh the cmux browser pane on the checkout page. Verify:
- the Delivery toggle shows `By our team · from $3.99`;
- under a $12 subtotal it shows `Add $X to enable`;
- entering an in-zone address yields a quote, and the displayed delivery fee matches the band for that distance (spot-check one near + one far address).

Capture `cmux browser console list` / `errors list` — no runtime errors. Screenshot for the record.

- [ ] **Step 5: Push to main**

```bash
git push origin main
```

Confirm GitHub auto-deploy picks it up (delivery flag already on in production → new pricing goes live).

---

## Notes for the implementer

- Money is BigInt cents everywhere; never use floats for amounts. `distanceKm` is a plain `number` (km) — that's the only float, used purely for band selection.
- Do not touch `STORE_LAT/STORE_LNG` (pre-existing "confirm with Google Maps" TODO is out of scope).
- This repo is on a non-standard Next.js — if you touch routing/server conventions, read `node_modules/next/dist/docs/` first. (This plan does not change any Next conventions.)
