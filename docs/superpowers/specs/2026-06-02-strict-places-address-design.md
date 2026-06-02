# Strict Google Places Address Selection — Design

**Date:** 2026-06-02
**Status:** Approved (brainstorm)
**Author:** /dev (Stan)

## Problem

On the delivery checkout the address field accepts free text. A customer can:

1. **Type without selecting** a suggestion — no lat/lng is captured. (Already
   blocked: the quote only fires when lat/lng are present, and the Pay button is
   disabled until `quoteState.kind === "ok"`.)
2. **Select a suggestion, then edit the text** — the input is uncontrolled
   (`defaultValue`, `onChange` undefined when a Places key is present), so editing
   does not update state or clear the captured lat/lng. The order proceeds with
   the *previously selected* address/coords while the field visibly shows
   something else. This is the real gap.

There is also a lenient dev fallback: when no Places key is configured, free text
is accepted and the store's own coordinates are stuffed in so quotes resolve.

**Requirement (Stan):** the customer must actually pick an address from the
Google Places dropdown — producing real coordinates — before the order can
continue. Enforced **everywhere**, including local dev (the lenient fallback is
removed).

## Decisions

- **Strict everywhere.** Remove the no-key free-text fallback. A valid delivery
  address can only come from a Places selection. Without a Places key the
  autocomplete cannot load, so delivery cannot proceed — accepted.
- **Local dev gets the production key.** So local autocomplete works and the
  strict flow is testable: pull `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY` from Vercel
  production into local `.env.local` (implementation step).
- **Edit-after-select invalidates.** Any manual edit that diverges from the
  confirmed selection clears the captured coordinates, which resets the quote and
  re-disables Pay until the customer re-selects.
- **Adjacent copy fix.** Two stale "11am–9:30pm" delivery-hours error strings in
  the checkout page are corrected to "10:30am–10:30pm" (hours changed earlier
  today).

## Architecture

### 1. `src/components/checkout/DeliveryAddressForm.tsx`

- **Remove** the `!PLACES_KEY` lenient branch (the `onChange` that wrote store
  coordinates on free text) and the "dev mode" hint that advertised it.
- Track the confirmed selection with a ref `confirmedAddressRef` holding the
  `formatted_address` of the last valid `place_changed`.
- The address input stays **uncontrolled** (`defaultValue={value.address}`) — a
  React `value=` would fight Google Autocomplete, which writes the chosen text
  directly into the DOM input. State is kept in sync via the `onChange` handler
  instead.
- Handlers:
  - **`place_changed`** (with `geometry.location`): call
    `onChange({ ...value, address: formatted_address, lat, lng })` and set
    `confirmedAddressRef.current = formatted_address`. This is the only path that
    sets non-zero coordinates.
  - **`onChange` on the input** (manual typing) — attached unconditionally now
    (not just in the no-key branch): call `onChange({ ...value, address: typed })`
    and, when `typed !== confirmedAddressRef.current`, also clear coords
    (`lat: 0, lng: 0`). Typing therefore always invalidates until a suggestion is
    re-selected. State mirrors the typed text without React controlling the DOM
    value.
- Derived UI state from `value`:
  - `confirmed = coordsAreValid(value.lat, value.lng)` → green "✓ Address
    confirmed".
  - `value.address` non-empty and not confirmed → amber "Pick your address from
    the suggestions to continue".
  - No Places key → "Address autocomplete unavailable" (delivery cannot proceed).

### 2. `src/lib/places.ts`

Add a small pure helper, unit-testable:

```ts
export function coordsAreValid(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
}
```

Used by the form to decide "confirmed" and available to any caller wanting the
same check. (The store is at lat -28, lng 153, so 0/0 is never a real Mandy's
delivery coordinate — it cleanly signals "unset".)

### 3. `src/app/checkout/page.tsx`

- **No gating change** — clearing coords flows through the existing quote effect
  (`!lat || !lng` → `setQuoteState({ kind: "idle" })`), which re-disables Pay.
- Fix the two stale hours strings: `"Delivery hours: 11am–9:30pm"` →
  `"Delivery hours: 10:30am–10:30pm"` (the `!hoursOpen` branch and the `closed`
  reason map entry).

## Data flow

```
type address → onChange: address=typed; if typed≠confirmed → lat=0,lng=0
   → quote effect sees no coords → quoteState idle → Pay disabled
pick suggestion → place_changed: address=formatted, lat/lng set, confirmedRef=formatted
   → quote effect fires → server validates radius/hours/min → quoteState ok → Pay enabled
edit after pick → onChange diverges from confirmedRef → coords cleared → back to blocked
```

## Error handling / edge cases

- Google writes the chosen `formatted_address` into the input and fires an input
  event *before* `place_changed`. The input `onChange` may briefly clear coords;
  `place_changed` immediately re-sets them and the ref. Net final state is
  confirmed; the transient extra render is harmless (React batches; the quote
  effect debounces to idle→ok).
- Returning to the form with a previously confirmed address (state already has
  coords): `confirmed` derives `true` from `coordsAreValid`, so it shows
  confirmed without forcing a re-pick.
- Server defense-in-depth already rejects `0,0` (and any out-of-radius) coords
  via `isWithinDeliveryRadius` → `out_of_zone`; the client guard is the UX layer.

## Testing

- **Unit (vitest):** `coordsAreValid` — valid coords true; `0,0` false; one-axis
  zero false; `NaN`/`Infinity` false; a real Mandy's coord true.
- **Browser (cmux):** with the local key present, on `/checkout` delivery mode:
  type without selecting → Pay stays disabled + amber hint; select a suggestion →
  "✓ confirmed" + quote resolves + Pay enables; edit the field after selecting →
  hint returns + Pay disables. Capture screenshots; check console clean.

## Out of scope

- Customer RN app delivery address (web only).
- Server-side address↔coords consistency (inherent limit; radius check stands).
- Confirming exact store lat/lng with Google Maps (pre-existing TODO).

## Rollout

Direct to `main` (per Stan): pull local key → TDD the helper → wire the form +
copy fixes → tsc clean + vitest green → browser walk → commit → push → GitHub
auto-deploy.
