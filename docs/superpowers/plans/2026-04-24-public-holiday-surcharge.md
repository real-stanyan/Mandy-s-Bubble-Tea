# Public Holiday Surcharge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 10% public holiday surcharge on online orders on QLD public holidays (and Christmas Eve from 18:00 Brisbane time), on both web (`mandys_bubble_tea`) and RN app (`mandys_bubble_tea_app`).

**Architecture:** Mirror the existing 1.9% card-surcharge pattern end-to-end: constants + holiday helper + server-side Square service charge + client-side line items + top banner on PH days. Two independent code trees (web + app) with copy-pasted holiday module; single shared `/api/orders` attaches the service charge server-side.

**Tech Stack:** Next.js 14 (web), Expo RN (app), TypeScript, Square API, Tailwind (web), vitest (web tests).

**Spec:** `docs/superpowers/specs/2026-04-24-public-holiday-surcharge-design.md`

**Repo layout:**
- Web repo: `/Users/stanyan/Github/mandys_bubble_tea` (primary CWD)
- App repo: `/Users/stanyan/Github/mandys_bubble_tea_app` (separate git repo)

---

## Phase 1 — Web core module

### Task 1: Add PH surcharge constants + 2026 holiday table

**Files:**
- Modify: `src/lib/constants.ts`

- [ ] **Step 1: Append to `src/lib/constants.ts` after `CARD_SURCHARGE_BPS`**

```ts
// ---- Public holiday surcharge ----

export const PH_SURCHARGE = {
  name: "Public holiday surcharge",
  percentage: "10",
};

export const PH_SURCHARGE_BPS = 1000n;

export type PublicHolidayDef = {
  name: string;
  date: string;        // YYYY-MM-DD in Brisbane TZ
  startHour?: number;  // Brisbane local hour; default 0 (whole day)
};

// QLD 2026 public holidays.
// TODO: refresh for 2027 before 2026-12-31.
export const PUBLIC_HOLIDAYS_2026: PublicHolidayDef[] = [
  { name: "New Year's Day",        date: "2026-01-01" },
  { name: "Australia Day",         date: "2026-01-26" },
  { name: "Good Friday",           date: "2026-04-03" },
  { name: "Easter Saturday",       date: "2026-04-04" },
  { name: "Easter Sunday",         date: "2026-04-05" },
  { name: "Easter Monday",         date: "2026-04-06" },
  { name: "ANZAC Day",             date: "2026-04-25" },
  { name: "Labour Day",            date: "2026-05-04" },
  { name: "King's Birthday",       date: "2026-10-05" },
  { name: "Christmas Eve",         date: "2026-12-24", startHour: 18 },
  { name: "Christmas Day",         date: "2026-12-25" },
  { name: "Boxing Day",            date: "2026-12-26" },
  { name: "Boxing Day (observed)", date: "2026-12-28" },
];
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (only pre-existing `.next/types/validator.ts` errors, if any)

- [ ] **Step 3: Commit**

```bash
git add src/lib/constants.ts
git commit -m "feat(ph-surcharge): add PH surcharge constants and 2026 QLD holiday table"
```

---

### Task 2: Write failing tests for `holiday.ts` (TDD)

**Files:**
- Create: `src/lib/__tests__/holiday.test.ts`

- [ ] **Step 1: Create the test file**

```ts
import { describe, it, expect } from "vitest";
import { getActivePublicHoliday, isPublicHolidayActive } from "../holiday";

// Helper: build a Date from Brisbane wall-clock (UTC+10).
function brisbane(ymd: string, hh = 12, mm = 0): Date {
  // "2026-04-25 12:00 Brisbane" = "2026-04-25 02:00 UTC"
  return new Date(`${ymd}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+10:00`);
}

describe("getActivePublicHoliday", () => {
  it("returns null on a regular weekday", () => {
    expect(getActivePublicHoliday(brisbane("2026-04-24"))).toBeNull();
  });

  it("matches ANZAC Day at 00:00 Brisbane", () => {
    const ph = getActivePublicHoliday(brisbane("2026-04-25", 0, 0));
    expect(ph?.name).toBe("ANZAC Day");
  });

  it("matches ANZAC Day at 23:59 Brisbane", () => {
    const ph = getActivePublicHoliday(brisbane("2026-04-25", 23, 59));
    expect(ph?.name).toBe("ANZAC Day");
  });

  it("returns null before 18:00 on Christmas Eve", () => {
    expect(getActivePublicHoliday(brisbane("2026-12-24", 17, 59))).toBeNull();
  });

  it("matches Christmas Eve at 18:00 Brisbane", () => {
    const ph = getActivePublicHoliday(brisbane("2026-12-24", 18, 0));
    expect(ph?.name).toBe("Christmas Eve");
  });

  it("matches Christmas Eve at 23:30 Brisbane", () => {
    const ph = getActivePublicHoliday(brisbane("2026-12-24", 23, 30));
    expect(ph?.name).toBe("Christmas Eve");
  });

  it("handles UTC-day-boundary edge: Brisbane 00:05 Jan 1 is still NYD", () => {
    // 2025-12-31 14:05 UTC = 2026-01-01 00:05 Brisbane
    const nowUtc = new Date("2025-12-31T14:05:00Z");
    const ph = getActivePublicHoliday(nowUtc);
    expect(ph?.name).toBe("New Year's Day");
  });
});

describe("isPublicHolidayActive", () => {
  it("true on ANZAC Day", () => {
    expect(isPublicHolidayActive(brisbane("2026-04-25", 12))).toBe(true);
  });

  it("false on a regular Friday", () => {
    expect(isPublicHolidayActive(brisbane("2026-04-24", 12))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests and confirm they fail**

Run: `npx vitest run src/lib/__tests__/holiday.test.ts`
Expected: FAIL — `Cannot find module '../holiday'` or similar.

---

### Task 3: Implement `holiday.ts` to make tests pass

**Files:**
- Create: `src/lib/holiday.ts`

- [ ] **Step 1: Create the file**

```ts
// Brisbane = UTC+10 year-round (QLD has no DST since 1992).
// Single source of truth for PH detection used by server, UI, and banner.

import { PUBLIC_HOLIDAYS_2026, type PublicHolidayDef } from "./constants";

const ALL_HOLIDAYS: PublicHolidayDef[] = [...PUBLIC_HOLIDAYS_2026];

function brisbaneParts(now: Date): { ymd: string; hour: number } {
  const ms = now.getTime() + 10 * 60 * 60 * 1000;
  const d = new Date(ms);
  return { ymd: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
}

export function getActivePublicHoliday(
  now: Date = new Date(),
): PublicHolidayDef | null {
  const { ymd, hour } = brisbaneParts(now);
  const match = ALL_HOLIDAYS.find((h) => h.date === ymd);
  if (!match) return null;
  if (match.startHour != null && hour < match.startHour) return null;
  return match;
}

export function isPublicHolidayActive(now: Date = new Date()): boolean {
  return getActivePublicHoliday(now) !== null;
}
```

- [ ] **Step 2: Run tests and confirm they pass**

Run: `npx vitest run src/lib/__tests__/holiday.test.ts`
Expected: PASS — all 9 tests green.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors beyond pre-existing `.next/types/validator.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/holiday.ts src/lib/__tests__/holiday.test.ts
git commit -m "feat(ph-surcharge): add Brisbane-TZ holiday detector with tests"
```

---

### Task 4: Add `publicHolidaySurcharge` helper + tests

**Files:**
- Modify: `src/store/cart.ts` (add export)
- Create: `src/store/__tests__/surcharge.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/store/__tests__/surcharge.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { publicHolidaySurcharge, cardSurcharge } from "../cart";

describe("publicHolidaySurcharge", () => {
  it("computes 10% of the base in cents (BigInt)", () => {
    expect(publicHolidaySurcharge(620n)).toBe(62n);
    expect(publicHolidaySurcharge(1240n)).toBe(124n);
    expect(publicHolidaySurcharge(0n)).toBe(0n);
  });

  it("floors for uneven divisions", () => {
    // 10% of $1.23 = 0.123 → 12 cents (BigInt integer division truncates)
    expect(publicHolidaySurcharge(123n)).toBe(12n);
  });
});

describe("cardSurcharge sanity (baseline)", () => {
  it("computes 1.9% of the base", () => {
    // 1.9% of $6.20 = 0.1178 → 11 cents floor
    expect(cardSurcharge(620n)).toBe(11n);
  });
});
```

- [ ] **Step 2: Run and confirm failing**

Run: `npx vitest run src/store/__tests__/surcharge.test.ts`
Expected: FAIL — `publicHolidaySurcharge is not exported` or similar.

- [ ] **Step 3: Add the helper to `src/store/cart.ts`**

Find the `cardSurcharge` export (around line 165) and add `publicHolidaySurcharge` below it:

```ts
export function publicHolidaySurcharge(baseCents: bigint): bigint {
  return (baseCents * PH_SURCHARGE_BPS) / 10000n;
}
```

Update the import at top of the file — add `PH_SURCHARGE_BPS` to the existing `@/lib/constants` import alongside `CARD_SURCHARGE_BPS`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/store/__tests__/surcharge.test.ts`
Expected: PASS — 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/store/cart.ts src/store/__tests__/surcharge.test.ts
git commit -m "feat(ph-surcharge): add publicHolidaySurcharge helper"
```

---

## Phase 2 — Web server: attach Square service charge

### Task 5: Attach PH service charge in `/api/orders`

**Files:**
- Modify: `src/app/api/orders/route.ts`

**Context:** The existing route already attaches a `card-surcharge` service charge conditionally on `!body.applyLoyaltyReward` (see line ~277). We add a parallel `public-holiday-surcharge` entry, ordered **before** card surcharge so receipts list PH first. The route does NOT trust any client-provided flag — it calls `isPublicHolidayActive(new Date())` server-side.

- [ ] **Step 1: Update imports at top of `src/app/api/orders/route.ts`**

Add to existing imports:

```ts
import { BUSINESS, CARD_SURCHARGE, PH_SURCHARGE } from "@/lib/constants";
import { getActivePublicHoliday } from "@/lib/holiday";
```

(Replace the existing `import { BUSINESS, CARD_SURCHARGE } from "@/lib/constants";` line.)

- [ ] **Step 2: Locate the existing `serviceCharges` array build**

Find the code around line 277 that conditionally adds the card surcharge:

```ts
serviceCharges: body.applyLoyaltyReward
  ? undefined
  : [
      {
        uid: "card-surcharge",
        name: CARD_SURCHARGE.name,
        percentage: CARD_SURCHARGE.percentage,
        calculationPhase: "SUBTOTAL_PHASE",
        taxable: false,
      },
    ],
```

- [ ] **Step 3: Replace with a computed `serviceCharges` that may contain 0, 1, or 2 entries**

Before the `order:` object is built, compute the charges:

```ts
const activePH = getActivePublicHoliday(new Date());
const skipSurcharges = body.applyLoyaltyReward === true;

const orderServiceCharges: Array<{
  uid: string;
  name: string;
  percentage: string;
  calculationPhase: "SUBTOTAL_PHASE";
  taxable: boolean;
}> = [];

if (!skipSurcharges && activePH) {
  orderServiceCharges.push({
    uid: "public-holiday-surcharge",
    name: `${PH_SURCHARGE.name} (${activePH.name})`,
    percentage: PH_SURCHARGE.percentage,
    calculationPhase: "SUBTOTAL_PHASE",
    taxable: false,
  });
}

if (!skipSurcharges) {
  orderServiceCharges.push({
    uid: "card-surcharge",
    name: CARD_SURCHARGE.name,
    percentage: CARD_SURCHARGE.percentage,
    calculationPhase: "SUBTOTAL_PHASE",
    taxable: false,
  });
}
```

Then update the order body:

```ts
serviceCharges: orderServiceCharges.length > 0 ? orderServiceCharges : undefined,
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Manual API sanity check**

Start dev server: `npm run dev` (background)

Sanity curl — non-PH day (today, 2026-04-24) should produce 0 or 1 service charge depending on `applyLoyaltyReward`:

```bash
curl -s -X POST http://localhost:3000/api/orders -H 'Content-Type: application/json' -d '{
  "items": [{"catalogObjectId":"64VKZZ5CHCKUEDOJAXSXMFAK","variationId":"64VKZZ5CHCKUEDOJAXSXMFAK","quantity":1}],
  "applyLoyaltyReward": false
}' | python3 -m json.tool | grep -A 2 '"serviceCharges"' | head -10
```

Expected: `card-surcharge` entry present, no `public-holiday-surcharge` (because 2026-04-24 is not PH).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/orders/route.ts
git commit -m "feat(ph-surcharge): attach Public holiday surcharge service charge to Square orders"
```

---

## Phase 3 — Web client: line items + banner

### Task 6: Render PH surcharge row in cart drawer

**Files:**
- Modify: `src/components/cart/CartDrawer.tsx`

**Context:** CartDrawer computes `surchargeAmount = cardSurcharge(subtotal)` around line 167 and shows a `Card surcharge (1.9%)` row at line 820. We compute a parallel `phSurchargeAmount` and render it above the card line, with the same hide-when-free-redeem behavior.

- [ ] **Step 1: Update imports at top of `CartDrawer.tsx`**

Find the existing import from `@/store/cart`:

```ts
import { useCart, cardSurcharge } from "@/store/cart";
```

Change to:

```ts
import { useCart, cardSurcharge, publicHolidaySurcharge } from "@/store/cart";
import { isPublicHolidayActive } from "@/lib/holiday";
```

Also extend the `BRAND, CARD_SURCHARGE, LOYALTY` import to include `PH_SURCHARGE`.

- [ ] **Step 2: Compute `phSurchargeAmount` alongside `surchargeAmount`**

Below the existing line:

```ts
const surchargeAmount = useMemo(() => cardSurcharge(subtotal), [subtotal]);
```

add:

```ts
// PH surcharge — checked client-side only for display; server is authoritative.
const phActive = useMemo(() => isPublicHolidayActive(), []);
const phSurchargeAmount = useMemo(
  () => (phActive ? publicHolidaySurcharge(subtotal) : 0n),
  [phActive, subtotal],
);
```

- [ ] **Step 3: Pre-add to Apple/Google Pay sheet amount**

Find the two `amount: (Number(subtotal + surchargeAmount) / 100).toFixed(2)` lines (around 207 and 227) and change both to:

```ts
amount: (Number(subtotal + surchargeAmount + phSurchargeAmount) / 100).toFixed(2),
```

- [ ] **Step 4: Pass `phSurchargeAmount` through to the summary component**

Where the drawer renders the internal summary (around line 331), add the new prop next to `surchargeAmount`:

```tsx
<Summary
  ...existing props...
  surchargeAmount={surchargeAmount}
  phSurchargeAmount={phSurchargeAmount}
/>
```

- [ ] **Step 5: Extend the summary component signature**

Find `surchargeAmount,` in the summary component prop destructure (around line 571) and its type block (around line 589). Add:

```ts
phSurchargeAmount: bigint;
```

And destructure `phSurchargeAmount` next to `surchargeAmount`.

- [ ] **Step 6: Compute `effectivePhSurcharge` parallel to `effectiveSurcharge`**

Below:

```ts
const effectiveSurcharge = isFreeRedeem ? 0n : surchargeAmount;
```

add:

```ts
const effectivePhSurcharge = isFreeRedeem ? 0n : phSurchargeAmount;
```

- [ ] **Step 7: Render the PH row above the card row**

Find the existing JSX around line 820 for `{CARD_SURCHARGE.name}` row. Insert directly above it:

```tsx
{effectivePhSurcharge > 0n && (
  <div className="flex justify-between text-sm text-zinc-600">
    <span>
      {PH_SURCHARGE.name}{" "}
      <span className="text-xs text-zinc-400">({PH_SURCHARGE.percentage}%)</span>
    </span>
    <span>+{formatPrice(effectivePhSurcharge)}</span>
  </div>
)}
```

- [ ] **Step 8: Update the total line**

Find where `subtotal + effectiveSurcharge` is summed for the displayed total. Change to:

```ts
subtotal + effectiveSurcharge + effectivePhSurcharge
```

(Search for `subtotal + effectiveSurcharge` — there may be 1–2 occurrences.)

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 10: Commit**

```bash
git add src/components/cart/CartDrawer.tsx
git commit -m "feat(ph-surcharge): show PH surcharge row in cart drawer"
```

---

### Task 7: Render PH surcharge row in checkout page

**Files:**
- Modify: `src/app/checkout/page.tsx`

**Context:** Checkout page has a `surchargeAmount` + `effectiveSurcharge` pattern identical to CartDrawer (spec confirms 2 render sites: main summary and sticky-bottom summary). Apply the same transformation.

- [ ] **Step 1: Update imports at top**

Add to the existing `@/store/cart` import:

```ts
import { useCart, cardSurcharge, publicHolidaySurcharge } from "@/store/cart";
import { isPublicHolidayActive } from "@/lib/holiday";
```

Extend the `BRAND, CARD_SURCHARGE, LOYALTY` import to include `PH_SURCHARGE`.

- [ ] **Step 2: Compute `phSurchargeAmount`**

Below:

```ts
const surchargeAmount = useMemo(() => cardSurcharge(subtotal), [subtotal]);
```

(around line 184) add:

```ts
const phActive = useMemo(() => isPublicHolidayActive(), []);
const phSurchargeAmount = useMemo(
  () => (phActive ? publicHolidaySurcharge(subtotal) : 0n),
  [phActive, subtotal],
);
```

- [ ] **Step 3: Update the total computation**

Find the existing total computation (around line 208):

```ts
return afterDiscount + surchargeAmount;
```

Change to:

```ts
return afterDiscount + surchargeAmount + (isFreeRedeem ? 0n : phSurchargeAmount);
```

(If `isFreeRedeem` is defined below, hoist the computation or use the existing `effectiveSurcharge`/`effectivePhSurcharge` pattern as in CartDrawer.)

- [ ] **Step 4: Compute `effectivePhSurcharge`**

Next to:

```ts
const effectiveSurcharge = isFreeRedeem ? 0n : surchargeAmount;
```

(around line 221) add:

```ts
const effectivePhSurcharge = isFreeRedeem ? 0n : phSurchargeAmount;
```

- [ ] **Step 5: Render PH row in both summary sites (2 occurrences)**

Find the `{CARD_SURCHARGE.name}` JSX at line ~679 AND ~892 (there are 2 copies: main summary + sticky). Above each, insert:

```tsx
{effectivePhSurcharge > 0n && (
  <div className="flex justify-between text-sm text-zinc-600">
    <span>
      {PH_SURCHARGE.name}{" "}
      <span className="text-xs text-zinc-400">({PH_SURCHARGE.percentage}%)</span>
    </span>
    <span>+{formatPrice(effectivePhSurcharge)}</span>
  </div>
)}
```

- [ ] **Step 6: Update sticky footer aggregate text (around line 967)**

Find:

```tsx
Incl. {CARD_SURCHARGE.name} {formatPrice(effectiveSurcharge)}
```

Change to:

```tsx
{effectivePhSurcharge > 0n && (
  <>Incl. {PH_SURCHARGE.name} {formatPrice(effectivePhSurcharge)} · </>
)}
Incl. {CARD_SURCHARGE.name} {formatPrice(effectiveSurcharge)}
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 8: Commit**

```bash
git add src/app/checkout/page.tsx
git commit -m "feat(ph-surcharge): show PH surcharge row on checkout page"
```

---

### Task 8: Add `PublicHolidayBanner` component and mount in root layout

**Files:**
- Create: `src/components/layout/PublicHolidayBanner.tsx`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Create the banner component**

```tsx
// src/components/layout/PublicHolidayBanner.tsx
import { getActivePublicHoliday } from "@/lib/holiday";

export function PublicHolidayBanner() {
  const ph = getActivePublicHoliday();
  if (!ph) return null;
  return (
    <div className="bg-[#C43A10] px-4 py-2 text-center text-xs font-medium text-white sm:text-sm">
      Today is {ph.name} — a 10% public holiday surcharge applies to all online orders.
    </div>
  );
}
```

- [ ] **Step 2: Mount in root layout**

In `src/app/layout.tsx`, find where `<SiteHeaderGate />` renders (inside `<body>` around the top of the shell) and add `<PublicHolidayBanner />` immediately **above** it:

```tsx
import { PublicHolidayBanner } from "@/components/layout/PublicHolidayBanner";
// ...inside the body shell, before SiteHeaderGate...
<PublicHolidayBanner />
<SiteHeaderGate />
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual visual smoke (via cmux browser)**

Start dev server if not running.
Navigate: `http://localhost:3000/`

Expected on 2026-04-24 (non-PH): no banner (zero height at top of page).

Temporarily verify by editing `PUBLIC_HOLIDAYS_2026[0].date` to today's date, reload, see banner, then revert the edit.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/PublicHolidayBanner.tsx src/app/layout.tsx
git commit -m "feat(ph-surcharge): add site-wide public holiday banner"
```

---

### Task 9: End-to-end local verification on web

- [ ] **Step 1: Temporarily set today as a PH in `constants.ts`**

Edit `src/lib/constants.ts` — change one entry's `date` to today's Brisbane date (e.g., `"2026-04-24"`). Save.

- [ ] **Step 2: Exercise full flow**

Open `http://localhost:3000/`:
- Banner visible at top reading the holiday name.

Add 2 drinks to cart, open cart drawer:
- "Public holiday surcharge (10%) +$X.XX" row appears above card surcharge row.
- Drawer total = subtotal + PH + card.

Proceed to `/checkout`:
- Both summary sites show PH row.
- Sticky footer aggregate text shows PH + card.

Send a test order via `curl` (or click Place Order in a preview env):
- `/api/orders` response JSON contains both `public-holiday-surcharge` and `card-surcharge` entries in `service_charges`.

- [ ] **Step 3: Revert the temp edit**

Restore `constants.ts` to the real 2026 dates.

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: all PH-surcharge tests green; no regressions.

- [ ] **Step 5: Commit (only if the revert left any uncommitted diff — should be clean)**

```bash
git status
# If clean, no commit needed.
```

---

## Phase 4 — RN App core module

**Note:** Switch working directory / repo for Phase 4–5:

```bash
cd /Users/stanyan/Github/mandys_bubble_tea_app
```

All subsequent paths in these tasks are **relative to the app repo**.

### Task 10: Add PH surcharge constants to app

**Files:**
- Modify: `lib/constants.ts`

- [ ] **Step 1: Append to `lib/constants.ts`**

Paste the same block from web Task 1 Step 1 (constants + `PublicHolidayDef` type + `PUBLIC_HOLIDAYS_2026` array). Verbatim copy.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/constants.ts
git commit -m "feat(ph-surcharge): add PH surcharge constants and 2026 QLD holiday table"
```

---

### Task 11: Add `holiday.ts` to app

**Files:**
- Create: `lib/holiday.ts`

**Context:** App has no vitest/jest configured. Skip unit tests here (Manual QA covers it). The module is a byte-for-byte copy of the web version.

- [ ] **Step 1: Create the file**

Paste the contents of the web `src/lib/holiday.ts` verbatim (from Task 3 Step 1). Adjust import path: in app, the relative import `from "./constants"` is already correct.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/holiday.ts
git commit -m "feat(ph-surcharge): add Brisbane-TZ holiday detector"
```

---

## Phase 5 — RN App client

### Task 12: Compute PH surcharge + pre-add to Apple/Google Pay in `checkout.tsx`

**Files:**
- Modify: `app/checkout.tsx`

**Context:** App checkout is a single large file. Existing pattern (lines 178–247):

```ts
const surchargeCents = isFreeRedeem ? 0 : Math.floor((total * 190) / 10000)
// ...
if (!isFreeOrder && surchargeCents > 0) {
  amountCents += surchargeCents
}
```

We add a parallel `phSurchargeCents`.

- [ ] **Step 1: Add imports at top of `app/checkout.tsx`**

Add to existing imports:

```ts
import { isPublicHolidayActive } from '@/lib/holiday'
import { PH_SURCHARGE } from '@/lib/constants'
```

- [ ] **Step 2: Compute `phSurchargeCents` next to `surchargeCents` (around line 178)**

Below the existing:

```ts
const surchargeCents = isFreeRedeem ? 0 : Math.floor((total * 190) / 10000)
```

add:

```ts
const phActive = isPublicHolidayActive()
const phSurchargeCents = isFreeRedeem || !phActive
  ? 0
  : Math.floor((total * 1000) / 10000)  // 10%
```

- [ ] **Step 3: Include PH surcharge in the displayed total (around line 180)**

Find:

```ts
total - rewardDiscountCents - (welcomeDiscountForSummary?.amountCents ?? 0) + surchargeCents,
```

Change to:

```ts
total - rewardDiscountCents - (welcomeDiscountForSummary?.amountCents ?? 0) + surchargeCents + phSurchargeCents,
```

- [ ] **Step 4: Pre-add PH surcharge to Apple/Google Pay `amountCents` (around line 243)**

Find the existing:

```ts
if (!isFreeOrder && surchargeCents > 0) {
  amountCents += surchargeCents
}
```

Change to:

```ts
if (!isFreeOrder) {
  if (phSurchargeCents > 0) amountCents += phSurchargeCents
  if (surchargeCents > 0) amountCents += surchargeCents
}
```

- [ ] **Step 5: Pass `phSurchargeCents` to the summary component (around line 386)**

Find:

```tsx
surcharge={surchargeCents}
```

Add next line:

```tsx
phSurcharge={phSurchargeCents}
```

- [ ] **Step 6: Extend the summary component prop signature (around line 667–672)**

Find:

```ts
function Summary({
  ...
  surcharge,
  ...
}: {
  ...
  surcharge: number
  ...
}) {
```

Add `phSurcharge` destructure and `phSurcharge: number` to the type.

- [ ] **Step 7: Include PH in the inner-total computation (around line 675)**

Find:

```ts
const total = Math.max(subtotal - discountTotal + surcharge, 0)
```

Change to:

```ts
const total = Math.max(subtotal - discountTotal + surcharge + phSurcharge, 0)
```

- [ ] **Step 8: Render PH row above card row (around line 689)**

Find:

```tsx
{surcharge > 0 && (
  <SummaryRow label="Card surcharge (1.9%)" amountCents={surcharge} muted />
)}
```

Insert **above** it:

```tsx
{phSurcharge > 0 && (
  <SummaryRow
    label={`${PH_SURCHARGE.name} (${PH_SURCHARGE.percentage}%)`}
    amountCents={phSurcharge}
    muted
  />
)}
```

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 10: Commit**

```bash
git add app/checkout.tsx
git commit -m "feat(ph-surcharge): display PH surcharge on app checkout + pre-add to Apple/Google Pay"
```

---

### Task 13: Add `PublicHolidayBanner` RN component

**Files:**
- Create: `components/home/PublicHolidayBanner.tsx`

- [ ] **Step 1: Create the component**

```tsx
// components/home/PublicHolidayBanner.tsx
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { getActivePublicHoliday } from '@/lib/holiday';
import { T } from '@/constants/theme';

export function PublicHolidayBanner() {
  const [ph, setPh] = useState(() => getActivePublicHoliday());

  useEffect(() => {
    const id = setInterval(() => setPh(getActivePublicHoliday()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!ph) return null;

  return (
    <View style={styles.banner}>
      <Text style={styles.text}>
        Today is {ph.name} — 10% public holiday surcharge applies.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#C43A10',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  text: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
  },
});
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add components/home/PublicHolidayBanner.tsx
git commit -m "feat(ph-surcharge): add PublicHolidayBanner component"
```

---

### Task 14: Mount banner on Home and Menu screens

**Files:**
- Modify: `app/(tabs)/index.tsx`
- Modify: `app/(tabs)/menu.tsx`

- [ ] **Step 1: Mount on Home**

In `app/(tabs)/index.tsx`, add to imports:

```ts
import { PublicHolidayBanner } from '@/components/home/PublicHolidayBanner';
```

Inside the `<ScrollView>`, insert **as the first child** (before `<HomeHeader />`):

```tsx
<PublicHolidayBanner />
<HomeHeader />
```

- [ ] **Step 2: Mount on Menu**

In `app/(tabs)/menu.tsx`, add the same import. Find the outermost `<View>` or `<ScrollView>` that wraps the menu content and insert `<PublicHolidayBanner />` as the first child (above any existing header/section-list).

If unsure of the exact mount point, search for the first `<View>` that renders the main menu content and place the banner there. The banner self-hides on non-PH days, so there's no visual cost if it's slightly early in the tree.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add "app/(tabs)/index.tsx" "app/(tabs)/menu.tsx"
git commit -m "feat(ph-surcharge): mount PH banner on Home and Menu"
```

---

## Phase 6 — End-to-end verification

### Task 15: App manual QA

**Note:** Still in app repo.

- [ ] **Step 1: Temporarily make today a PH**

Edit `lib/constants.ts` and set one holiday's `date` to today's Brisbane YYYY-MM-DD.

- [ ] **Step 2: Run on simulator**

```bash
npm run ios
```

Verify:
- Home screen: banner at top shows holiday name.
- Menu screen: banner at top.
- Add 2 drinks → checkout: PH row above Card row, total includes both.
- Apple Pay (if simulator supports it): sheet total equals the checkout-displayed total.
- Redeem free drink: both surcharges hidden, total = $0.

- [ ] **Step 3: Revert the temp edit**

Restore the real 2026 date.

- [ ] **Step 4: Commit if diff left (should be clean)**

```bash
git status
```

---

### Task 16: Cross-repo sanity + push

**Note:** Two commits (web + app) happen in their respective repos.

- [ ] **Step 1: Web repo — run full typecheck and tests once more**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea
npx tsc --noEmit
npx vitest run
```

Expected: typecheck clean (except pre-existing `.next/types/validator.ts` errors), all tests green.

- [ ] **Step 2: Push web**

```bash
git push origin main
```

- [ ] **Step 3: App repo — typecheck**

```bash
cd /Users/stanyan/Github/mandys_bubble_tea_app
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 4: Push app**

```bash
git push origin main
```

- [ ] **Step 5: Verify Vercel preview deployment**

Open the Vercel deployment for the web push (should auto-trigger — if not, Create Deployment manually per the Vercel GitHub App recovery steps from HANDOFF). Once live, on a non-PH day confirm no banner appears and no PH line on checkout.

- [ ] **Step 6: Schedule real-world verification**

Record in DEV_QUEUE: on **2026-04-25 (ANZAC Day) morning**, place one real order through both web and app to confirm:
- Banner shows on both.
- Square Dashboard order detail shows both service charges, correct line labels including holiday name.
- Receipt/POS ticket prints the surcharge line.

---

## Self-Review

**Spec coverage:**
- Q1 (2026 dates) → Task 1 ✓
- Q2 (independent 10% + 1.9%) → Tasks 4, 5, 6, 7, 12 ✓
- Q3 (Christmas Eve 18:00) → Task 2 tests + Task 3 implementation ✓
- Q4 (free redeem skip, partial on post-reward) → Tasks 5 (server `applyLoyaltyReward`), 6 (`effectivePhSurcharge`), 7, 12 ✓
- Q5 (checkout line + home/menu banner) → Tasks 6, 7 (web lines); 8 (web banner); 12 (app line); 14 (app banner) ✓
- Q6 (web + app complete + Apple/Google Pay pre-add) → Tasks 6 Step 3, 12 Step 4 ✓

**Annual maintenance note** — covered by comment in Task 1 constants and by spec "Annual maintenance" section.

**Apple Pay sheet mismatch risk** — explicitly fixed in both Task 6 Step 3 (web) and Task 12 Step 4 (app).

**Free-redeem hide behavior** — tasks reuse the pre-existing `isFreeRedeem` branching consistently.

**Server-side authority** — Task 5 uses `getActivePublicHoliday(new Date())` server-side, ignores client. Clients display based on their own clock but server is authoritative for the charge itself.

**Type/name consistency** — `phSurchargeAmount` (web, BigInt), `phSurchargeCents` (app, number) — intentional parity with existing `surchargeAmount` / `surchargeCents` naming in each repo.

**No placeholders found** in the plan.
