# Public Holiday Surcharge — Design Spec

**Date**: 2026-04-24
**Scope**: Web (`mandys_bubble_tea`) + RN App (`mandys_bubble_tea_app`)
**Status**: Approved, ready for implementation plan

## Goal

Charge a 10% public holiday surcharge on online orders on Queensland public holidays (and on Christmas Eve from 18:00 Brisbane time), mirroring the existing 1.9% card-surcharge pattern end-to-end: server-side Square service charge, client-side line items on cart/checkout, and a top banner on home/menu on PH days.

## Decisions (locked)

| # | Decision |
|---|---|
| Q1 | Hardcode 12 QLD public holiday dates for 2026 in `constants.ts`; refresh annually via TODO comment. |
| Q2 | PH 10% and Card 1.9% are **independent** — both apply to the reward-adjusted subtotal. Effective combined rate = 11.9%. |
| Q3 | Christmas Eve is **strict 18:00 Brisbane time** cutoff. Orders at 17:59 pay 0%, 18:00 pay 10%. |
| Q4 | **Free redeem** (total ≤ 0 after reward) skips PH and card surcharges both. Partial reward (e.g. 2 drinks − 1 free): PH/card computed on the **post-reward** amount. |
| Q5 | Checkout + cart-drawer show a line `Public holiday surcharge (10%) +$X.XX`. Home and menu pages show a top banner on PH days. |
| Q6 | Web + App both display the line item AND the banner. Apple/Google Pay sheet `amountCents` must pre-add PH surcharge (else iOS rejects the auth when sheet total ≠ actual charge). |

## Approach (locked)

**Mirror the existing card-surcharge pattern** end-to-end. No registry abstraction, no shared library — web and app keep independent but identical modules. Lowest risk, highest consistency with existing code.

## Architecture

### 1. Data model — `src/lib/constants.ts`

```ts
export const PH_SURCHARGE = {
  name: "Public holiday surcharge",
  percentage: "10",
};
export const PH_SURCHARGE_BPS = 1000n;

export type PublicHolidayDef = {
  name: string;
  date: string;        // YYYY-MM-DD in Brisbane TZ
  startHour?: number;  // Brisbane local hour, default 0 (whole day)
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

RN app `lib/constants.ts` gets an identical block (copy-paste, not shared lib).

### 2. Holiday detection — `src/lib/holiday.ts` (new file, same in RN app)

```ts
import { PUBLIC_HOLIDAYS_2026, type PublicHolidayDef } from "./constants";

const ALL_HOLIDAYS: PublicHolidayDef[] = [...PUBLIC_HOLIDAYS_2026];

function brisbaneParts(now: Date): { ymd: string; hour: number } {
  const ms = now.getTime() + 10 * 60 * 60 * 1000;
  const d = new Date(ms);
  return { ymd: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
}

export function getActivePublicHoliday(now: Date = new Date()): PublicHolidayDef | null {
  const { ymd, hour } = brisbaneParts(now);
  const match = ALL_HOLIDAYS.find(h => h.date === ymd);
  if (!match) return null;
  if (match.startHour != null && hour < match.startHour) return null;
  return match;
}

export function isPublicHolidayActive(now: Date = new Date()): boolean {
  return getActivePublicHoliday(now) !== null;
}
```

**Design notes**:
- UTC+10 hard offset (QLD has no DST since 1992).
- Returns the `PublicHolidayDef` so banner can show holiday name.
- `now` is a parameter to enable unit-test time injection.
- Single source of truth used by server, client, and banner.

### 3. Surcharge calculation — `src/store/cart.ts`

```ts
export function publicHolidaySurcharge(baseCents: bigint): bigint {
  return (baseCents * PH_SURCHARGE_BPS) / 10000n;
}
```

**Computation order** (non-free path):
```
afterReward   = subtotal − rewardDiscount
phSurcharge   = isPHActive ? publicHolidaySurcharge(afterReward) : 0
cardSurcharge = cardSurcharge(afterReward)
total         = afterReward + phSurcharge + cardSurcharge
```

**Free redeem path**: if `isFreeRedeem`, both surcharges are skipped and `total = 0`.

**Worked example** (ANZAC Day, 2 drinks − redeem 1 free):
- Subtotal $12.40, reward −$6.20 → afterReward $6.20
- PH 10% = $0.62, Card 1.9% = $0.12 (rounded)
- **Total = $6.94**

### 4. Square order — `src/app/api/orders/route.ts`

Attach PH as a second `service_charges` entry, ordered BEFORE card surcharge:

```ts
const phInfo = getActivePublicHoliday(new Date());
const isPH = phInfo !== null;
const serviceCharges = [];

if (isPH && !skipCardSurcharge) {
  serviceCharges.push({
    uid: "public-holiday-surcharge",
    name: `Public holiday surcharge (${phInfo!.name})`,
    percentage: "10",
    calculationPhase: "SUBTOTAL_PHASE",
    taxable: false,
  });
}

if (!skipCardSurcharge) {
  serviceCharges.push({
    uid: "card-surcharge",
    name: CARD_SURCHARGE.name,
    percentage: CARD_SURCHARGE.percentage,
    calculationPhase: "SUBTOTAL_PHASE",
    taxable: false,
  });
}
```

**Design notes**:
- `SUBTOTAL_PHASE` → Square computes percentage on subtotal automatically (same as card).
- Server never trusts client's `isPH` — always recomputes from `new Date()`. If client displays it but server disagrees, server wins (money correctness > UI match).
- Holiday name goes into the service-charge `name` so POS receipts show which holiday (e.g. `Public holiday surcharge (ANZAC Day)`).
- PH uid precedes card uid so receipts render PH above card line.

### 5. Web UI

**A. Cart drawer + checkout summary rows** (4 render sites):
- `src/components/cart/CartDrawer.tsx` — drawer body, Apple Pay sheet summary
- `src/app/checkout/page.tsx` — main summary, sticky-bottom summary

Add above the existing "Card surcharge (1.9%)" row:
```tsx
{phSurcharge > 0n && (
  <div className="flex justify-between text-sm text-zinc-600">
    <span>Public holiday surcharge (10%)</span>
    <span>+{formatPrice(phSurcharge)}</span>
  </div>
)}
```

Free-redeem hides PH line via same `isFreeRedeem` branch already used for card.

**B. Top banner** — new `src/components/layout/PublicHolidayBanner.tsx`:

Server component. Placed in `src/app/layout.tsx` above `<SiteHeader />`. Returns `null` on non-PH days (zero layout footprint).

```tsx
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

Uses brand primary red for visibility. Refresh via existing Next `revalidate: 10` (max 10 s delay at midnight / 18:00 boundary).

### 6. RN App

**A. Constants + holiday.ts** — copy of web 1 & 2.

**B. SummaryBlock line** (`components/checkout/SummaryBlock.tsx`):
Add `phSurcharge: number` prop next to existing `surcharge: number`. Render row identically, PH above card.

**C. Checkout compute** (`app/(screens)/checkout.tsx`):
```ts
const isPHActive = isPublicHolidayActive();
const phSurchargeCents = !isFreeRedeem && isPHActive
  ? Math.floor(afterRewardCents * 1000 / 10000)
  : 0;
```

**D. Apple/Google Pay sheet** — `handlePay` must pre-add phSurcharge:
```ts
let amountCents = total;
if (!isFreeOrder) {
  if (phSurchargeCents > 0) amountCents += phSurchargeCents;
  if (surchargeCents > 0)   amountCents += surchargeCents;
}
```
(This is the same class of fix as commit `493d8c5` for card surcharge — mandatory to pass iOS auth validation.)

**E. Banner** — new `components/home/PublicHolidayBanner.tsx`:
Client component (RN has no server components). `useState` + `setInterval(60_000)` to refresh day/hour boundary without requiring app relaunch. Mounted at top of `app/(tabs)/index.tsx` and `app/(tabs)/menu.tsx`.

**F. Server** — unchanged; RN shares `/api/orders` with web and gets the service charge for free.

### 7. Testing

**Unit tests** (Jest — web; jest-expo — app):

`src/lib/__tests__/holiday.test.ts`:
- Regular weekday → null
- ANZAC Day at 00:00 and 23:59 Brisbane → match
- Christmas Eve at 17:59 Brisbane → null
- Christmas Eve at 18:00 Brisbane → match
- UTC day-boundary edge: 2025-12-31 14:05 UTC = 2026-01-01 00:05 Brisbane → NYD

`src/store/__tests__/cart.test.ts`:
- `publicHolidaySurcharge(620n)` = `62n`
- Free-redeem scenario: both surcharges skipped

**Manual QA checklist** (Vercel preview + real device):

| Scenario | Expected |
|---|---|
| 2026-04-24 (non-PH) | No banner, no PH line |
| 2026-04-25 (ANZAC), 2 drinks $12.40 | Banner "Today is ANZAC Day", PH +$1.24 |
| 2026-12-24 17:30 Brisbane | No banner |
| 2026-12-24 18:00 Brisbane | Banner + PH line appear |
| Free redeem on PH | Total $0, no PH/card lines |
| 2 drinks + redeem 1 free on PH | PH $0.62, card $0.12, total $6.94 |
| Apple Pay on PH (iOS real device) | Sheet total == actual charge; auth succeeds |

**Not tested**:
- End-to-end Square order E2E (no staging env — covered by manual QA).
- Banner visual regression (low ROI).

**Production rollout verification**:
- Deploy Vercel preview → temporarily set one PH date to "today" → exercise flow → revert.
- On 2026-04-25 (ANZAC) morning: place a real order at the shop to confirm banner + Square receipt both show PH surcharge.

## Files touched (implementation-level summary)

**Web** (`mandys_bubble_tea`):
- `src/lib/constants.ts` — add constants + holiday array (modify)
- `src/lib/holiday.ts` — new
- `src/lib/__tests__/holiday.test.ts` — new
- `src/store/cart.ts` — add `publicHolidaySurcharge` helper (modify)
- `src/store/__tests__/cart.test.ts` — new assertions (modify/new)
- `src/app/api/orders/route.ts` — attach PH service charge (modify)
- `src/components/cart/CartDrawer.tsx` — add summary row (modify)
- `src/app/checkout/page.tsx` — compute + render (modify)
- `src/components/layout/PublicHolidayBanner.tsx` — new
- `src/app/layout.tsx` — mount banner (modify)

**App** (`mandys_bubble_tea_app`):
- `lib/constants.ts` — parallel block (modify)
- `lib/holiday.ts` — new
- `components/checkout/SummaryBlock.tsx` — add PH row prop (modify)
- `app/(screens)/checkout.tsx` — compute + pre-add to Apple/Google Pay (modify)
- `components/home/PublicHolidayBanner.tsx` — new
- `app/(tabs)/index.tsx` — mount banner (modify)
- `app/(tabs)/menu.tsx` — mount banner (modify)

## Out of scope

- Delivery orders (app is pickup-only today; revisit when delivery ships).
- In-store POS surcharge (Square POS handles service charges separately via Dashboard rules — owner can configure there independently).
- Email/push notification day-before reminder (Q5 offered; declined as over-engineering).
- Surcharge-registry abstraction (YAGNI — one extra surcharge doesn't justify refactor).

## Annual maintenance

On or before **2026-12-31**: open `constants.ts`, append `PUBLIC_HOLIDAYS_2027` using the QLD Government's published holiday list (https://www.qld.gov.au/recreation/travel/holidays/public), update `ALL_HOLIDAYS` spread in `holiday.ts`, ship. ~5 minutes of work.
