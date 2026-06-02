# Strict Google Places Address Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require the delivery address to be a real Google Places selection (with non-zero lat/lng); editing the field after selecting invalidates it, and the free-text dev fallback is removed.

**Architecture:** A pure `coordsAreValid` helper in `places.ts` defines "confirmed". `DeliveryAddressForm` keeps the input uncontrolled but attaches an `onChange` that clears coords whenever the typed text diverges from the last `place_changed` selection (tracked in a ref). Checkout's existing quote-gating then blocks Pay until a fresh selection produces coords. Two stale delivery-hours copy strings are corrected.

**Tech Stack:** Next.js (App Router), React, TypeScript, Google Maps Places JS SDK, vitest.

**Spec:** `docs/superpowers/specs/2026-06-02-strict-places-address-design.md`

---

## File Structure

- Modify: `src/lib/places.ts` — add `coordsAreValid(lat, lng)`.
- Test: `src/lib/__tests__/places.test.ts` — tests for `coordsAreValid`.
- Modify: `src/components/checkout/DeliveryAddressForm.tsx` — strict select-only flow + UI states.
- Modify: `src/app/checkout/page.tsx` — fix two stale "11am–9:30pm" hours strings.

---

### Task 1: `coordsAreValid` helper

**Files:**
- Modify: `src/lib/places.ts`
- Test: `src/lib/__tests__/places.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `src/lib/__tests__/places.test.ts` (and add `coordsAreValid` to the import on line 2 so it reads `import { coordsAreValid, distanceKm, isWithinDeliveryRadius } from "../places";`):

```ts
describe("coordsAreValid", () => {
  it("true for a real Mandy's-area coordinate", () => {
    expect(coordsAreValid(-28.0084, 153.4116)).toBe(true);
  });
  it("false for 0,0 (the 'unset' sentinel)", () => {
    expect(coordsAreValid(0, 0)).toBe(false);
  });
  it("false when only latitude is 0", () => {
    expect(coordsAreValid(0, 153.4116)).toBe(false);
  });
  it("false when only longitude is 0", () => {
    expect(coordsAreValid(-28.0084, 0)).toBe(false);
  });
  it("false for NaN", () => {
    expect(coordsAreValid(NaN, NaN)).toBe(false);
  });
  it("false for Infinity", () => {
    expect(coordsAreValid(Infinity, 153)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/__tests__/places.test.ts`
Expected: FAIL — `coordsAreValid` is not exported (import/type error).

- [ ] **Step 3: Implement `coordsAreValid`**

Append to `src/lib/places.ts`:

```ts
// A delivery coordinate is "confirmed" only when it is finite and non-zero.
// The store sits at lat -28 / lng 153, so 0/0 is never a real Mandy's
// coordinate — the form uses it as the "no address selected yet" sentinel.
export function coordsAreValid(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/__tests__/places.test.ts`
Expected: PASS (all prior places tests + the 6 new `coordsAreValid` cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/places.ts src/lib/__tests__/places.test.ts
git commit -m "feat(delivery): add coordsAreValid helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Strict select-only `DeliveryAddressForm`

Rewrite the form so a valid address can only come from a Places selection, and any manual edit that diverges from the selection clears the coords. Remove the free-text dev fallback.

**Files:**
- Modify: `src/components/checkout/DeliveryAddressForm.tsx`

- [ ] **Step 1: Replace the component file**

Replace the entire contents of `src/components/checkout/DeliveryAddressForm.tsx` with:

```tsx
"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { coordsAreValid } from "@/lib/places";

export type DeliveryAddress = {
  address: string;
  lat: number;
  lng: number;
  unit: string;
  driverNote: string;
  phone: string;
};

type Props = {
  value: DeliveryAddress;
  onChange: (next: DeliveryAddress) => void;
  defaultPhone?: string;
};

const PLACES_KEY = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;

declare global {
  interface Window {
    google?: {
      maps?: {
        places?: {
          Autocomplete: new (
            input: HTMLInputElement,
            opts: { componentRestrictions?: { country: string }; fields?: string[] },
          ) => {
            addListener: (event: string, cb: () => void) => void;
            getPlace: () => {
              formatted_address?: string;
              geometry?: { location?: { lat: () => number; lng: () => number } };
            };
          };
        };
      };
    };
    initGooglePlaces?: () => void;
  }
}

// Loads the Google Places script once per page. Idempotent — multiple
// instances of this form share the same `<script>` tag. No-op when the
// API key is missing (autocomplete then cannot load, and delivery cannot
// proceed — by design, addresses must be selected, not typed).
function ensureGoogleScript() {
  if (typeof window === "undefined") return;
  if (!PLACES_KEY) return;
  if (window.google?.maps?.places) return;
  if (document.getElementById("google-places-sdk")) return;
  const s = document.createElement("script");
  s.id = "google-places-sdk";
  s.async = true;
  s.src = `https://maps.googleapis.com/maps/api/js?key=${PLACES_KEY}&libraries=places&loading=async`;
  document.head.appendChild(s);
}

export function DeliveryAddressForm({ value, onChange, defaultPhone }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  // The formatted_address of the last confirmed Places selection. Manual edits
  // that diverge from this invalidate the captured coordinates.
  const confirmedAddressRef = useRef<string>(
    coordsAreValid(value.lat, value.lng) ? value.address : "",
  );
  const [phoneSeed, setPhoneSeed] = useState(defaultPhone ?? "");

  // Keep refs current so the autocomplete listener (attached once) always
  // reads the latest value/onChange without re-attaching on every re-render.
  useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
  }, [value, onChange]);

  useEffect(() => {
    if (!PLACES_KEY) return;
    ensureGoogleScript();
    let cancelled = false;
    const tryAttach = () => {
      if (cancelled) return;
      if (!window.google?.maps?.places || !inputRef.current) {
        setTimeout(tryAttach, 200);
        return;
      }
      const ac = new window.google.maps.places.Autocomplete(inputRef.current, {
        componentRestrictions: { country: "au" },
        fields: ["formatted_address", "geometry"],
      });
      ac.addListener("place_changed", () => {
        const place = ac.getPlace();
        const loc = place.geometry?.location;
        if (place.formatted_address && loc) {
          confirmedAddressRef.current = place.formatted_address;
          onChangeRef.current({
            ...valueRef.current,
            address: place.formatted_address,
            lat: loc.lat(),
            lng: loc.lng(),
          });
        }
      });
    };
    tryAttach();
    return () => {
      cancelled = true;
    };
  }, []);

  const confirmed = coordsAreValid(value.lat, value.lng);

  // Manual typing. Mirror the text into state, and invalidate coordinates the
  // moment the text diverges from the confirmed selection. Google writes the
  // chosen text into the input and fires this before `place_changed`; the
  // listener above then re-confirms, so the final state is valid.
  const handleAddressInput = (e: ChangeEvent<HTMLInputElement>) => {
    const typed = e.target.value;
    const diverged = typed !== confirmedAddressRef.current;
    onChange({
      ...value,
      address: typed,
      ...(diverged ? { lat: 0, lng: 0 } : {}),
    });
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-700">
          Delivery Address
        </label>
        <input
          ref={inputRef}
          type="text"
          placeholder="Start typing your address…"
          defaultValue={value.address}
          onChange={handleAddressInput}
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
        {!PLACES_KEY ? (
          <p className="mt-1 text-xs text-amber-700">
            Address autocomplete unavailable — delivery needs a selectable address.
          </p>
        ) : confirmed ? (
          <p className="mt-1 text-xs text-emerald-700">✓ Address confirmed</p>
        ) : value.address.trim().length > 0 ? (
          <p className="mt-1 text-xs text-amber-700">
            Pick your address from the suggestions to continue.
          </p>
        ) : null}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-700">
          Apartment / Unit (optional)
        </label>
        <input
          type="text"
          value={value.unit}
          onChange={(e) => onChange({ ...value, unit: e.target.value })}
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-700">
          Note for driver (optional)
        </label>
        <textarea
          rows={2}
          maxLength={120}
          value={value.driverNote}
          onChange={(e) => onChange({ ...value, driverNote: e.target.value })}
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-700">
          Phone (required for delivery)
        </label>
        <input
          type="tel"
          value={value.phone || phoneSeed}
          onChange={(e) => {
            setPhoneSeed(e.target.value);
            onChange({ ...value, phone: e.target.value });
          }}
          placeholder="0404 978 238"
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck the form**

Run: `npx tsc --noEmit 2>&1 | grep -i "DeliveryAddressForm"`
Expected: no output (form compiles clean).

---

### Task 3: Fix stale delivery-hours copy in checkout

The hours changed to 10:30–22:30 earlier today; two error strings still say "11am–9:30pm".

**Files:**
- Modify: `src/app/checkout/page.tsx`

- [ ] **Step 1: Replace both stale strings**

There are two occurrences of `Delivery hours: 11am–9:30pm` in `src/app/checkout/page.tsx` — one in the `!hoursOpen` branch and one in the `closed:` reason map. Replace **both** with `Delivery hours: 10:30am–10:30pm`.

Use a single replace-all on the exact string:
- Old: `Delivery hours: 11am–9:30pm`
- New: `Delivery hours: 10:30am–10:30pm`

- [ ] **Step 2: Verify both were replaced**

Run: `grep -n "Delivery hours" src/app/checkout/page.tsx`
Expected: two lines, both showing `10:30am–10:30pm`; zero `11am–9:30pm` remaining.

- [ ] **Step 3: Commit Tasks 2 + 3**

```bash
git add src/components/checkout/DeliveryAddressForm.tsx src/app/checkout/page.tsx
git commit -m "feat(delivery): require a Google Places selection for the address

Address coords are only set by a place_changed selection; typing that
diverges from the confirmed selection clears them, so the existing quote
gate disables Pay until the customer re-selects. Removes the free-text
dev fallback. Also fixes two stale 11am-9:30pm hours strings.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Local key, verification, push

**Files:** none (config + verification).

- [ ] **Step 1: Pull the production Places key into local `.env.local`**

The repo's `.env.local` has no `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY`; without it
local autocomplete cannot load and the strict flow is untestable. Pull the value
from Vercel production and append it:

```bash
cd ~/Github/mandys_bubble_tea
KEY=$(vercel env pull --environment=production /tmp/mbt-prod.env --yes >/dev/null 2>&1 && grep '^NEXT_PUBLIC_GOOGLE_PLACES_API_KEY=' /tmp/mbt-prod.env)
echo "$KEY" >> .env.local
rm -f /tmp/mbt-prod.env
grep -c NEXT_PUBLIC_GOOGLE_PLACES_API_KEY .env.local
```
Expected: prints `1` (key now present). If `vercel env pull` is not authenticated
or the var is absent, fall back to `vercel env ls` / the Vercel dashboard and add
the line by hand. `.env.local` is gitignored — it is never committed.

- [ ] **Step 2: Full typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -iE "DeliveryAddressForm|places|checkout/page"`
Expected: no output. (Pre-existing unrelated `scripts/`/`tests/` errors may remain.)

- [ ] **Step 3: Full delivery test run**

Run: `npx vitest run src/lib/__tests__/places.test.ts src/lib/__tests__/delivery-fee.test.ts src/lib/__tests__/delivery-hours.test.ts`
Expected: PASS.

- [ ] **Step 4: Browser walk (cmux)**

Restart the dev server (so it loads the new `.env.local` key) on port 3000, then
on `/checkout` with a non-empty cart, switch to Delivery and verify:
- typing a partial address without selecting → amber "Pick your address…" hint,
  Pay stays disabled;
- selecting a suggestion → "✓ Address confirmed", quote resolves, Pay enables;
- editing the field after selecting → hint returns, Pay disables again.

Capture screenshots and confirm no console errors. If the dev server cannot reach
Google (offline) or the key is restricted to the prod domain, record this as a
known-gap rather than blocking.

- [ ] **Step 5: Push**

```bash
git push origin main
```
Confirm GitHub auto-deploy picks it up.

---

## Notes for the implementer

- `defaultValue` + `onChange` keeps the input uncontrolled — do NOT switch to a
  React `value=`; Google Autocomplete writes the chosen text into the DOM input
  directly and a controlled value fights it.
- `0,0` is the "no selection" sentinel. Never treat it as a real coordinate.
- Do not commit `.env.local` (it is gitignored).
