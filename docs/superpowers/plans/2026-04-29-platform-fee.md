# Platform Fee (0.4%) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third Square service charge "Platform Fee" at 0.4% alongside the existing PH (10% holiday-only) and Card Surcharge (1.9%), visible to the customer at every surface (cart, checkout, Apple/Google Pay sheet, Square Dashboard, email receipt, POS ticket).

**Architecture:** Mirror the existing CARD_SURCHARGE pattern — a constant + BPS pair in `lib/constants.ts`, a BigInt floor helper in `src/store/cart.ts` (web) / a new `lib/surcharge.ts` (RN app), a third entry pushed onto Square's `orderServiceCharges` array between PH and Card Surcharge in `/api/orders`, and a third row rendered in every breakdown component. RN app side also resolves the QUEUE-tracked 1.0.8 surcharge math gap by switching all three client-side surcharge helpers to `Math.round` on pre-discount base (matches Square SUBTOTAL_PHASE round-half-up).

**Tech Stack:** Next.js 14 (App Router) + TypeScript + Square Orders API + Vitest (web). React Native + Expo + TypeScript + Jest (app).

**Branch policy:** All commits land on `main` in both repos. Web `main` worktree is `/Users/stanyan/Github/mandys_bubble_tea-hours` (the current `mandys_bubble_tea` worktree is on `feat/cup-label-tsp100` and is **not** in scope for this plan). RN-app `main` is its own primary worktree.

**Spec:** `docs/superpowers/specs/2026-04-29-platform-fee-design.md` (committed `7e2ddc7` on web main).

**File Structure:**

Web repo (`/Users/stanyan/Github/mandys_bubble_tea-hours`):
- Modify: `src/lib/constants.ts` (add `PLATFORM_FEE` + `PLATFORM_FEE_BPS`)
- Modify: `src/store/cart.ts` (add `platformFee` helper)
- Modify: `src/store/__tests__/surcharge.test.ts` (TDD)
- Modify: `src/app/api/orders/route.ts` (push platform-fee service charge between PH and Card)
- Modify: `src/components/cart/CartDrawer.tsx` (memo + Apple/Google Pay totals + footer prop + render row)
- Modify: `src/app/checkout/page.tsx` (memo + total math + 2 summary blocks + sticky-bar footer "Incl." line)
- Modify: `src/lib/email/complaint-mail.test.ts` (fixture totalsLine)

RN-app repo (`/Users/stanyan/Github/mandys_bubble_tea_app`):
- Modify: `lib/constants.ts` (add `CARD_SURCHARGE` + `CARD_SURCHARGE_BPS` + `PLATFORM_FEE` + `PLATFORM_FEE_BPS` — note: app currently has only PH constants)
- Create: `lib/surcharge.ts` (helper module, parallel to web `cart.ts`)
- Create: `lib/surcharge.test.ts`
- Modify: `app/checkout.tsx` (replace inline `Math.floor((total * 190) / 10000)` and `Math.floor((total * 1000) / 10000)` with helper calls; add platform-fee call; pass new prop to SummaryBlock; add row in SummaryBlock; thread into Apple/Google Pay total)
- Modify: `app.json` (or `expo` config — bump version to `1.1.1`, build to `12`)
- Modify: `ios/mandysbubbleteaapp/Info.plist` (`CFBundleShortVersionString` `1.1.1`, `CFBundleVersion` `12`)
- Modify: `ios/mandysbubbleteaapp.xcodeproj/project.pbxproj` (`MARKETING_VERSION = 1.1.1`, `CURRENT_PROJECT_VERSION = 12` — sed only, do NOT run `expo prebuild --clean` per project memory)

---

## PHASE A — WEB (commit on main)

### Task A1: Add PLATFORM_FEE constants

**Files:**
- Modify: `src/lib/constants.ts:48`

- [ ] **Step 1: Add the constants directly after `CARD_SURCHARGE_BPS`**

Open `src/lib/constants.ts`. After line 51 (`export const CARD_SURCHARGE_BPS = 190n;`) and before the `// ---- Public holiday surcharge ----` comment block on line 53, insert:

```ts

// Platform Fee — additional online-ordering pass-through service charge.
// Same SUBTOTAL_PHASE / non-taxable / skipped-on-free-redeem pattern as
// CARD_SURCHARGE. Customer-visible on every receipt surface.
export const PLATFORM_FEE = {
  name: "Platform Fee",
  /** Percentage as a string — matches Square's OrderServiceCharge.percentage format. */
  percentage: "0.4",
} as const;

/** 0.4% as basis-points-per-10000 for BigInt math: 40 / 10000. */
export const PLATFORM_FEE_BPS = 40n;
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS (no new errors).

- [ ] **Step 3: Commit**

```bash
git add src/lib/constants.ts
git commit -m "feat(constants): add PLATFORM_FEE 0.4% online-order pass-through"
```

---

### Task A2: Add `platformFee` helper (TDD)

**Files:**
- Modify: `src/store/__tests__/surcharge.test.ts`
- Modify: `src/store/cart.ts:5,168`

- [ ] **Step 1: Add failing test cases**

Open `src/store/__tests__/surcharge.test.ts`. After the `describe("cardSurcharge sanity (baseline)", ...)` block (after line 27), append:

```ts

describe("platformFee", () => {
  it("computes 0.4% of the base in cents (BigInt)", () => {
    // 0.4% of $6.20 = 0.0248 → floor 2 cents
    expect(platformFee(620n)).toBe(2n);
    // 0.4% of $12.40 = 0.0496 → floor 4 cents
    expect(platformFee(1240n)).toBe(4n);
    expect(platformFee(0n)).toBe(0n);
  });

  it("floors for uneven divisions", () => {
    // 0.4% of $1.25 = 0.005 → floor 0 cents (Square server may round to 1; ≤1c divergence is OK)
    expect(platformFee(125n)).toBe(0n);
  });

  it("clamps negative inputs to 0 (mirrors cardSurcharge)", () => {
    expect(platformFee(-1n)).toBe(0n);
    expect(platformFee(-1000n)).toBe(0n);
  });

  it("computes large-amount math without overflow", () => {
    // 0.4% of $10,000.00 = $40.00
    expect(platformFee(1_000_000n)).toBe(4_000n);
  });
});
```

Update the import at line 2 of `src/store/__tests__/surcharge.test.ts`:

```ts
import { publicHolidaySurcharge, cardSurcharge, platformFee } from "../cart";
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test -- surcharge`
Expected: FAIL — `platformFee is not exported from "../cart"` (or similar resolution error).

- [ ] **Step 3: Add the helper**

Open `src/store/cart.ts`. Update the import on line 5:

```ts
import { CARD_SURCHARGE_BPS, PH_SURCHARGE_BPS, PLATFORM_FEE_BPS } from "@/lib/constants";
```

After the `cardSurcharge` function (after line 169 `}`), add:

```ts

// Mirrors Square's SUBTOTAL_PHASE percentage service charge: 0.4% of the
// pre-discount subtotal, truncated to whole cents. UI-display only — Square's
// totalMoney is the authoritative charged amount; ≤1c divergence may exist
// at certain price points due to Square's round-half-up vs. BigInt floor.
export function platformFee(subtotalCents: bigint): bigint {
  if (subtotalCents <= 0n) return 0n;
  return (subtotalCents * PLATFORM_FEE_BPS) / 10000n;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm run test -- surcharge`
Expected: PASS — all platformFee + existing cardSurcharge + publicHolidaySurcharge cases pass.

- [ ] **Step 5: Commit**

```bash
git add src/store/cart.ts src/store/__tests__/surcharge.test.ts
git commit -m "feat(cart): add platformFee BigInt helper + tests"
```

---

### Task A3: Server-side — push platform-fee onto serviceCharges between PH and Card

**Files:**
- Modify: `src/app/api/orders/route.ts:5,376-384`

- [ ] **Step 1: Update the constants import**

At line 5 of `src/app/api/orders/route.ts`:

```ts
import { BUSINESS, CARD_SURCHARGE, PH_SURCHARGE, PLATFORM_FEE } from "@/lib/constants";
```

- [ ] **Step 2: Insert platform-fee push between PH and Card blocks**

Find the existing block (lines 376-384):

```ts
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

Replace it with two pushes (Platform Fee first, Card Surcharge second) inside the same guard:

```ts
    if (!skipSurcharges) {
      orderServiceCharges.push({
        uid: "platform-fee",
        name: PLATFORM_FEE.name,
        percentage: PLATFORM_FEE.percentage,
        calculationPhase: "SUBTOTAL_PHASE",
        taxable: false,
      });

      orderServiceCharges.push({
        uid: "card-surcharge",
        name: CARD_SURCHARGE.name,
        percentage: CARD_SURCHARGE.percentage,
        calculationPhase: "SUBTOTAL_PHASE",
        taxable: false,
      });
    }
```

- [ ] **Step 3: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/orders/route.ts
git commit -m "feat(orders): attach Platform Fee 0.4% service charge between PH and Card"
```

---

### Task A4: CartDrawer — memo, Apple/Google Pay totals, footer prop, render row

**Files:**
- Modify: `src/components/cart/CartDrawer.tsx:21,184,263,284,395-396,641-642,669-670,719-721,969-991`

- [ ] **Step 1: Update imports**

At line 21:

```tsx
import { BRAND, CARD_SURCHARGE, LOYALTY, PH_SURCHARGE, PLATFORM_FEE } from "@/lib/constants";
```

At wherever `cardSurcharge` is imported from `@/store/cart` (also around line 21 area — search for `cardSurcharge` import), add `platformFee`:

```tsx
import {
  cardSurcharge,
  cartSubtotal,
  cartItemCount,
  lineUnitPrice,
  lineTotal,
  platformFee,
  publicHolidaySurcharge,
  type CartLine,
  useCart,
} from "@/store/cart";
```

(Verify the existing import block — only add `platformFee` if not already there; preserve existing names.)

- [ ] **Step 2: Add `platformFeeAmount` memo**

After line 184 (`const surchargeAmount = useMemo(() => cardSurcharge(subtotal), [subtotal]);`), insert:

```tsx
  const platformFeeAmount = useMemo(() => platformFee(subtotal), [subtotal]);
```

- [ ] **Step 3: Update Apple Pay paymentRequest total**

Find the Apple Pay block at line 263:

```tsx
            amount: (Number(subtotal + surchargeAmount + phSurchargeAmount) / 100).toFixed(2),
```

Replace with (add `+ platformFeeAmount`):

```tsx
            amount: (Number(subtotal + surchargeAmount + platformFeeAmount + phSurchargeAmount) / 100).toFixed(2),
```

- [ ] **Step 4: Update Google Pay paymentRequest total**

Find the Google Pay block at line 284 (same structure). Replace:

```tsx
            amount: (Number(subtotal + surchargeAmount + phSurchargeAmount) / 100).toFixed(2),
```

With:

```tsx
            amount: (Number(subtotal + surchargeAmount + platformFeeAmount + phSurchargeAmount) / 100).toFixed(2),
```

- [ ] **Step 5: Pass `platformFeeAmount` prop to CartFooter**

Find the `<CartFooter ... />` JSX block around lines 384-406. After `surchargeAmount={surchargeAmount}` (line 395), insert:

```tsx
          platformFeeAmount={platformFeeAmount}
```

So the surrounding lines become:

```tsx
          surchargeAmount={surchargeAmount}
          platformFeeAmount={platformFeeAmount}
          phSurchargeAmount={phSurchargeAmount}
```

- [ ] **Step 6: Add `platformFeeAmount` to CartFooter destructuring + type**

Find the `CartFooter` definition starting around line 631. At line 641 (the destructured params), after `surchargeAmount,` insert:

```tsx
  platformFeeAmount,
```

In the type annotation block around line 669, after `surchargeAmount: bigint;` insert:

```tsx
  platformFeeAmount: bigint;
```

- [ ] **Step 7: Compute `effectivePlatformFee` and include in `displayTotal`**

Find the block at lines 718-721:

```tsx
  const isFreeRedeem = useReward && subtotal - rewardDiscount <= 0n;
  const effectiveSurcharge = isFreeRedeem ? 0n : surchargeAmount;
  const effectivePhSurcharge = isFreeRedeem ? 0n : phSurchargeAmount;
  const displayTotal = discountedTotal + effectiveSurcharge + effectivePhSurcharge;
```

Replace with:

```tsx
  const isFreeRedeem = useReward && subtotal - rewardDiscount <= 0n;
  const effectiveSurcharge = isFreeRedeem ? 0n : surchargeAmount;
  const effectivePlatformFee = isFreeRedeem ? 0n : platformFeeAmount;
  const effectivePhSurcharge = isFreeRedeem ? 0n : phSurchargeAmount;
  const displayTotal =
    discountedTotal + effectiveSurcharge + effectivePlatformFee + effectivePhSurcharge;
```

- [ ] **Step 8: Render Platform Fee row between PH and Card Surcharge**

Find the summary breakdown around lines 969-991 (PH row at 969-979, Card Surcharge row at 980-991). Insert a new Platform Fee row between them — i.e. after the PH `</div>` closing on line 979 and before the `{effectiveSurcharge > 0n && (` opener on line 980:

```tsx
        {effectivePlatformFee > 0n && (
          <div className="flex justify-between text-sm text-zinc-600">
            <span>
              {PLATFORM_FEE.name}{" "}
              <span className="text-xs text-zinc-400">({PLATFORM_FEE.percentage}%)</span>
            </span>
            <span className="font-semibold text-zinc-900">
              {formatPrice(effectivePlatformFee)}
            </span>
          </div>
        )}
```

- [ ] **Step 9: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/components/cart/CartDrawer.tsx
git commit -m "feat(cart-drawer): render Platform Fee row + thread amount through wallet totals"
```

---

### Task A5: Checkout page — memo, displayTotal, two summary blocks, sticky-bar footer

**Files:**
- Modify: `src/app/checkout/page.tsx:19,199,249-264,746-771,988-1013,1092-1099`

- [ ] **Step 1: Update imports**

At line 19:

```tsx
import { BRAND, CARD_SURCHARGE, LOYALTY, PH_SURCHARGE, PLATFORM_FEE } from "@/lib/constants";
```

In the `@/store/cart` import block (search for `cardSurcharge`), add `platformFee` to the named imports.

- [ ] **Step 2: Add `platformFeeAmount` memo**

After line 199 (`const surchargeAmount = useMemo(() => cardSurcharge(subtotal), [subtotal]);`), insert:

```tsx
  // Platform Fee mirrors the SUBTOTAL_PHASE service charge attached in
  // /api/orders: 0.4% of the pre-discount subtotal.
  const platformFeeAmount = useMemo(() => platformFee(subtotal), [subtotal]);
```

- [ ] **Step 3: Update `displayTotal` math + add `effectivePlatformFee`**

Find the block at lines 238-264:

```tsx
  const displayTotal = useMemo(() => {
    if (isFreeRedeem) return 0n;
    const promoDiscountTotal = welcomeDiscountAmount + igFollowDiscountAmount;
    const afterDiscount =
      canRedeem && useReward
        ? (subtotal - rewardDiscount > 0n ? subtotal - rewardDiscount : 0n)
        : promoDiscountTotal > 0n
          ? (subtotal - promoDiscountTotal > 0n
              ? subtotal - promoDiscountTotal
              : 0n)
          : subtotal;
    return afterDiscount + surchargeAmount + phSurchargeAmount;
  }, [
    isFreeRedeem,
    subtotal,
    canRedeem,
    useReward,
    rewardDiscount,
    welcomeDiscountAmount,
    igFollowDiscountAmount,
    surchargeAmount,
    phSurchargeAmount,
  ]);
  // Hide the surcharge line from the order summary when the reward
  // will cover the order — the backend won't charge it.
  const effectiveSurcharge = isFreeRedeem ? 0n : surchargeAmount;
  const effectivePhSurcharge = isFreeRedeem ? 0n : phSurchargeAmount;
```

Replace with:

```tsx
  const displayTotal = useMemo(() => {
    if (isFreeRedeem) return 0n;
    const promoDiscountTotal = welcomeDiscountAmount + igFollowDiscountAmount;
    const afterDiscount =
      canRedeem && useReward
        ? (subtotal - rewardDiscount > 0n ? subtotal - rewardDiscount : 0n)
        : promoDiscountTotal > 0n
          ? (subtotal - promoDiscountTotal > 0n
              ? subtotal - promoDiscountTotal
              : 0n)
          : subtotal;
    return afterDiscount + surchargeAmount + platformFeeAmount + phSurchargeAmount;
  }, [
    isFreeRedeem,
    subtotal,
    canRedeem,
    useReward,
    rewardDiscount,
    welcomeDiscountAmount,
    igFollowDiscountAmount,
    surchargeAmount,
    platformFeeAmount,
    phSurchargeAmount,
  ]);
  // Hide the surcharge lines from the order summary when the reward
  // will cover the order — the backend won't charge them.
  const effectiveSurcharge = isFreeRedeem ? 0n : surchargeAmount;
  const effectivePlatformFee = isFreeRedeem ? 0n : platformFeeAmount;
  const effectivePhSurcharge = isFreeRedeem ? 0n : phSurchargeAmount;
```

- [ ] **Step 4: Insert Platform Fee row in the desktop summary block**

Find the desktop summary block at lines 746-771 (PH row at 746-758, Card Surcharge row at 759-771). Between the closing `)}` of the PH conditional on line 758 and the start of the Card Surcharge conditional `{effectiveSurcharge > 0n && (` on line 759, insert:

```tsx
                {effectivePlatformFee > 0n && (
                  <div className="flex justify-between text-sm text-zinc-600">
                    <span>
                      {PLATFORM_FEE.name}{" "}
                      <span className="text-xs text-zinc-400">
                        ({PLATFORM_FEE.percentage}%)
                      </span>
                    </span>
                    <span className="font-semibold text-zinc-900">
                      {formatPrice(effectivePlatformFee)}
                    </span>
                  </div>
                )}
```

- [ ] **Step 5: Insert Platform Fee row in the mobile summary block**

Find the second summary block at lines 988-1013 (PH row at 988-1000, Card Surcharge row at 1001-1013). Between the PH closing `)}` on line 1000 and the Card Surcharge opener on line 1001, insert:

```tsx
            {effectivePlatformFee > 0n && (
              <div className="flex justify-between text-sm text-zinc-600">
                <span>
                  {PLATFORM_FEE.name}{" "}
                  <span className="text-xs text-zinc-400">
                    ({PLATFORM_FEE.percentage}%)
                  </span>
                </span>
                <span className="font-semibold text-zinc-900">
                  {formatPrice(effectivePlatformFee)}
                </span>
              </div>
            )}
```

- [ ] **Step 6: Update sticky-bar footer "Incl." line**

Find the block at lines 1092-1099:

```tsx
            {effectiveSurcharge > 0n && (
              <p className="text-[11px] text-zinc-500">
                {effectivePhSurcharge > 0n && (
                  <>Incl. {PH_SURCHARGE.name} {formatPrice(effectivePhSurcharge)} · </>
                )}
                Incl. {CARD_SURCHARGE.name} {formatPrice(effectiveSurcharge)}
              </p>
            )}
```

Replace with (3-segment, Platform between PH and Card):

```tsx
            {effectiveSurcharge > 0n && (
              <p className="text-[11px] text-zinc-500">
                {effectivePhSurcharge > 0n && (
                  <>Incl. {PH_SURCHARGE.name} {formatPrice(effectivePhSurcharge)} · </>
                )}
                {effectivePlatformFee > 0n && (
                  <>Incl. {PLATFORM_FEE.name} {formatPrice(effectivePlatformFee)} · </>
                )}
                Incl. {CARD_SURCHARGE.name} {formatPrice(effectiveSurcharge)}
              </p>
            )}
```

- [ ] **Step 7: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/app/checkout/page.tsx
git commit -m "feat(checkout): render Platform Fee row in summaries + footer; thread into total"
```

---

### Task A6: Complaint email totalsLine fixture

**Files:**
- Modify: `src/lib/email/complaint-mail.test.ts:17`

> **Builder note:** `formatTotalsLine` at `src/app/api/orders/[orderId]/complaint/route.ts:274` iterates `order.serviceCharges` dynamically — once Task A3 attaches `platform-fee` to Square's serviceCharges, the production complaint email automatically includes the new line. No builder code change needed. Only the test fixture string needs to grow a Platform segment to keep the fixture realistic.

- [ ] **Step 1: Update the test fixture**

Open `src/lib/email/complaint-mail.test.ts`. Replace line 17:

```ts
  totalsLine: "Subtotal $14.70 · PH 10% $1.47 · Card 1.9% $0.27 · Total $16.44",
```

With:

```ts
  totalsLine: "Subtotal $14.70 · PH 10% $1.47 · Platform 0.4% $0.06 · Card 1.9% $0.27 · Total $16.50",
```

- [ ] **Step 2: Run the test file**

Run: `npm run test -- complaint-mail`
Expected: PASS — all 12 cases. Substring assertions like `expect(m.text).toContain("Subtotal $14.70")` still match the new fixture.

- [ ] **Step 3: Commit**

```bash
git add src/lib/email/complaint-mail.test.ts
git commit -m "test(complaint-mail): extend totalsLine fixture with Platform 0.4% segment"
```

---

### Task A7: Web verification + push

**Files:** none modified.

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 2: Full test suite**

Run: `npm run test`
Expected: ALL PASS — including the 4 new platformFee cases + updated complaint-mail fixture.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: success, no warnings about new code.

- [ ] **Step 4: (Recommended) Stress-test sandbox regression**

If the `feat/stress-test-payment` worktree at `/tmp/stress-test-wt` is set up (per QUEUE entry), run the 12-scenario harness in Square sandbox to catch payment-math regressions before deploy:

```bash
cd /tmp/stress-test-wt
git fetch origin
git checkout main
git reset --hard origin/main  # pick up new platform-fee changes
npm run stress:server  # in one terminal
npm run stress:run     # in another, port 3002
```

Expected: all 12 scenarios pass. Verify via the harness logs:
- "loyalty reward all-covers" → empty `serviceCharges`
- "welcome + plain" → `[platform-fee, card-surcharge]`, both bases use pre-discount subtotal
- "PH + welcome" (run on a PH date or seed sandbox) → `[public-holiday-surcharge, platform-fee, card-surcharge]`

Skip this step if worktree isn't set up; real-order smoke (Step 6) catches regressions too. Do not block deploy on a missing worktree.

- [ ] **Step 5: Push to origin**

```bash
git push origin main
```

Vercel auto-deploys.

- [ ] **Step 6: Real-order smoke (after Vercel marks Ready)**

On `mandybubbletea.com`:
1. Add 1 cup to cart → open cart drawer → confirm 3 rows: (no PH today unless on a holiday) → "Platform Fee (0.4%) $X.XX" + "Card Surcharge (1.9%) $X.XX"
2. Click Checkout → confirm same 3 rows in both desktop summary and mobile sticky-bar footer
3. Tap Apple Pay → confirm sheet total === checkout-page displayed total
4. Complete payment → confirm Square Dashboard order detail shows three service-charge lines (PH if applicable → Platform Fee → Card Surcharge) in that order
5. Open Square automated email receipt → confirm three lines present in same order
6. Confirm Square `totalMoney` === Apple Pay charged amount

If any step fails, do NOT proceed to Phase B. Investigate and fix on main.

---

## PHASE B — RN APP (commit on main of separate repo)

**Working directory for Phase B:** `/Users/stanyan/Github/mandys_bubble_tea_app`

> **Pre-flight:** the app repo's primary worktree currently has branch `feat/cup-label-app-doodle` checked out (per QUEUE — the doodle-agent branch). Switch to `main` first. The QUEUE notes the doodle branch is 11 commits behind main — that's a separate cleanup task for the doodle agent and out of scope here.

```bash
cd /Users/stanyan/Github/mandys_bubble_tea_app
git status  # verify clean or stash any noise
git checkout main
git pull origin main
```

### Task B1: Add CARD_SURCHARGE + PLATFORM_FEE to RN constants

**Files:**
- Modify: `lib/constants.ts:30`

> **Note:** The RN app currently does NOT have a `CARD_SURCHARGE` constant — the 1.9% rate is hardcoded in `app/checkout.tsx`. This task adds the missing constant alongside `PLATFORM_FEE`.

- [ ] **Step 1: Insert constants before the PH block**

Open `lib/constants.ts`. Before line 30 (`// ---- Public holiday surcharge ----`), insert:

```ts

// ---- Card surcharge ----
// Mirrors the SUBTOTAL_PHASE Square service charge attached in /api/orders.
export const CARD_SURCHARGE = {
  name: 'Card Surcharge',
  /** Percentage as a string — matches Square's OrderServiceCharge.percentage. */
  percentage: '1.9',
} as const

/** 1.9% as basis-points-per-10000 for BigInt math: 190 / 10000. */
export const CARD_SURCHARGE_BPS = 190n

// ---- Platform Fee ----
// Additional online-ordering pass-through. Same SUBTOTAL_PHASE pattern as
// CARD_SURCHARGE; visible to the customer on every receipt surface.
export const PLATFORM_FEE = {
  name: 'Platform Fee',
  percentage: '0.4',
} as const

/** 0.4% as basis-points-per-10000 for BigInt math: 40 / 10000. */
export const PLATFORM_FEE_BPS = 40n

```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck` (or `npx tsc --noEmit` if no script)
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/constants.ts
git commit -m "feat(constants): add CARD_SURCHARGE + PLATFORM_FEE constants"
```

---

### Task B2: Create `lib/surcharge.ts` helpers + tests (TDD)

**Files:**
- Create: `lib/surcharge.test.ts`
- Create: `lib/surcharge.ts`

> **Math choice:** unlike web (BigInt floor), RN uses JS Number with `Math.round` to better match Square SUBTOTAL_PHASE round-half-up behavior. This resolves the QUEUE-tracked 1.0.8 task. Resolves divergence at 0.5-cent boundaries.

- [ ] **Step 1: Write the failing test**

Create `lib/surcharge.test.ts` with content:

```ts
import { cardSurcharge, platformFee, publicHolidaySurcharge } from './surcharge'

describe('cardSurcharge (1.9%)', () => {
  it('rounds half-up (matches Square SUBTOTAL_PHASE)', () => {
    // 1.9% of 620 = 11.78 → round 12
    expect(cardSurcharge(620)).toBe(12)
    // 1.9% of 100 = 1.9 → round 2
    expect(cardSurcharge(100)).toBe(2)
    // 1.9% of 0 = 0
    expect(cardSurcharge(0)).toBe(0)
  })

  it('clamps negative inputs to 0', () => {
    expect(cardSurcharge(-1)).toBe(0)
  })
})

describe('platformFee (0.4%)', () => {
  it('rounds half-up', () => {
    // 0.4% of 620 = 2.48 → round 2
    expect(platformFee(620)).toBe(2)
    // 0.4% of 1240 = 4.96 → round 5
    expect(platformFee(1240)).toBe(5)
    // 0.4% of 125 = 0.5 → round 1 (Math.round half-up matches Square)
    expect(platformFee(125)).toBe(1)
    expect(platformFee(0)).toBe(0)
  })

  it('clamps negative inputs to 0', () => {
    expect(platformFee(-1)).toBe(0)
  })

  it('handles large amounts', () => {
    // 0.4% of $10,000.00 = $40.00
    expect(platformFee(1_000_000)).toBe(4_000)
  })
})

describe('publicHolidaySurcharge (10%)', () => {
  it('rounds half-up', () => {
    expect(publicHolidaySurcharge(620)).toBe(62)
    expect(publicHolidaySurcharge(125)).toBe(13) // 12.5 → round 13
    expect(publicHolidaySurcharge(0)).toBe(0)
  })

  it('clamps negative inputs to 0', () => {
    expect(publicHolidaySurcharge(-1)).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify failure**

Run: `npx jest lib/surcharge`
Expected: FAIL — module `./surcharge` not found.

- [ ] **Step 3: Implement the helpers**

Create `lib/surcharge.ts`:

```ts
import {
  CARD_SURCHARGE_BPS,
  PH_SURCHARGE_BPS,
  PLATFORM_FEE_BPS,
} from './constants'

// All helpers operate in integer cents and use Math.round to match Square's
// SUBTOTAL_PHASE round-half-up calculation (server is authoritative; client
// uses these for display + Apple/Google Pay sheet pre-compute).

export function cardSurcharge(subtotalCents: number): number {
  if (subtotalCents <= 0) return 0
  return Math.round((subtotalCents * Number(CARD_SURCHARGE_BPS)) / 10000)
}

export function platformFee(subtotalCents: number): number {
  if (subtotalCents <= 0) return 0
  return Math.round((subtotalCents * Number(PLATFORM_FEE_BPS)) / 10000)
}

export function publicHolidaySurcharge(baseCents: number): number {
  if (baseCents <= 0) return 0
  return Math.round((baseCents * Number(PH_SURCHARGE_BPS)) / 10000)
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx jest lib/surcharge`
Expected: PASS — all cases.

- [ ] **Step 5: Commit**

```bash
git add lib/surcharge.ts lib/surcharge.test.ts
git commit -m "feat(surcharge): centralize helpers with Math.round to match server SUBTOTAL_PHASE"
```

---

### Task B3: Refactor `app/checkout.tsx` to use helpers + add Platform Fee row

**Files:**
- Modify: `app/checkout.tsx:31,212-219,225-226,287-294,461-468,752-803`

- [ ] **Step 1: Update imports**

At line 31 of `app/checkout.tsx`:

```tsx
import { CARD_SURCHARGE, LOYALTY, PH_SURCHARGE, PLATFORM_FEE } from '@/lib/constants'
```

Add a new import (after the constants import or in a logical neighborhood):

```tsx
import { cardSurcharge, platformFee, publicHolidaySurcharge } from '@/lib/surcharge'
```

- [ ] **Step 2: Replace inline surcharge math**

Find the block at lines 212-219:

```tsx
  const surchargeCents = isFreeRedeem ? 0 : Math.floor((total * 190) / 10000)
  // PH surcharge mirrors the server-side detection: 10% of the pre-discount
  // subtotal, only on QLD public holidays (Christmas Eve from 18:00).
  // Skipped on free redeem for the same reason as the card surcharge.
  const phActive = isPublicHolidayActive()
  const phSurchargeCents = isFreeRedeem || !phActive
    ? 0
    : Math.floor((total * 1000) / 10000)
```

Replace with (calls to helpers + new Platform Fee line):

```tsx
  const surchargeCents = isFreeRedeem ? 0 : cardSurcharge(total)
  const platformFeeCents = isFreeRedeem ? 0 : platformFee(total)
  // PH surcharge mirrors the server-side detection: 10% of the pre-discount
  // subtotal, only on QLD public holidays (Christmas Eve from 18:00).
  // Skipped on free redeem for the same reason as the card surcharge.
  const phActive = isPublicHolidayActive()
  const phSurchargeCents = isFreeRedeem || !phActive
    ? 0
    : publicHolidaySurcharge(total)
```

- [ ] **Step 3: Include `platformFeeCents` in `displayedTotal`**

Find the block at lines 220-228:

```tsx
  const displayedTotal = Math.max(
    total
      - rewardDiscountCents
      - (welcomeDiscountForSummary?.amountCents ?? 0)
      - (igFollowDiscountForSummary?.amountCents ?? 0)
      + surchargeCents
      + phSurchargeCents,
    0,
  )
```

Replace with:

```tsx
  const displayedTotal = Math.max(
    total
      - rewardDiscountCents
      - (welcomeDiscountForSummary?.amountCents ?? 0)
      - (igFollowDiscountForSummary?.amountCents ?? 0)
      + surchargeCents
      + platformFeeCents
      + phSurchargeCents,
    0,
  )
```

- [ ] **Step 4: Include `platformFeeCents` in Apple/Google Pay total**

Find the block at lines 287-294:

```tsx
      const isFreeOrder = amountCents <= 0
      // Surcharges mirror the SUBTOTAL_PHASE service charges attached
      // server-side; add them to the Apple/Google Pay sheet total so the
      // user sees the real amount Square will capture. PH first to match
      // the server's receipt ordering.
      if (!isFreeOrder) {
        if (phSurchargeCents > 0) amountCents += phSurchargeCents
        if (surchargeCents > 0) amountCents += surchargeCents
      }
```

Replace with (PH → Platform → Card to match receipt ordering):

```tsx
      const isFreeOrder = amountCents <= 0
      // Surcharges mirror the SUBTOTAL_PHASE service charges attached
      // server-side; add them to the Apple/Google Pay sheet total so the
      // user sees the real amount Square will capture. PH → Platform → Card
      // matches the server's receipt ordering.
      if (!isFreeOrder) {
        if (phSurchargeCents > 0) amountCents += phSurchargeCents
        if (platformFeeCents > 0) amountCents += platformFeeCents
        if (surchargeCents > 0) amountCents += surchargeCents
      }
```

- [ ] **Step 5: Pass `platformFee` prop to `<SummaryBlock>`**

Find the JSX around lines 461-468:

```tsx
        <SummaryBlock
          subtotal={total}
          welcome={welcomeDiscountForSummary}
          igFollow={igFollowDiscountForSummary}
          rewardDiscount={rewardDiscountCents}
          surcharge={surchargeCents}
          phSurcharge={phSurchargeCents}
        />
```

Replace with (add `platformFee={platformFeeCents}`):

```tsx
        <SummaryBlock
          subtotal={total}
          welcome={welcomeDiscountForSummary}
          igFollow={igFollowDiscountForSummary}
          rewardDiscount={rewardDiscountCents}
          surcharge={surchargeCents}
          platformFee={platformFeeCents}
          phSurcharge={phSurchargeCents}
        />
```

- [ ] **Step 6: Update `SummaryBlock` to accept and render Platform Fee**

Find the `SummaryBlock` definition starting at line 752. Replace the entire block (lines 752-803) with:

```tsx
function SummaryBlock({
  subtotal,
  welcome,
  igFollow,
  rewardDiscount,
  surcharge,
  platformFee: platformFeeAmt,
  phSurcharge,
}: {
  subtotal: number
  welcome: { amountCents: number; percentage: number; coveredCount: number } | null
  igFollow: { amountCents: number; percentage: number; coveredCount: number } | null
  rewardDiscount: number
  surcharge: number
  platformFee: number
  phSurcharge: number
}) {
  const discountTotal =
    (welcome?.amountCents ?? 0) + (igFollow?.amountCents ?? 0) + rewardDiscount
  const total = Math.max(
    subtotal - discountTotal + surcharge + platformFeeAmt + phSurcharge,
    0,
  )
  return (
    <View style={styles.summaryCard}>
      <SummaryRow label="Subtotal" amountCents={subtotal} muted />
      {welcome && welcome.amountCents > 0 && (
        <SummaryRow
          label={`Welcome ${welcome.percentage}% off (${welcome.coveredCount} drink${welcome.coveredCount === 1 ? '' : 's'})`}
          amountCents={-welcome.amountCents}
          muted
        />
      )}
      {igFollow && igFollow.amountCents > 0 && (
        <SummaryRow
          label={`IG Follow ${igFollow.percentage}% off (${igFollow.coveredCount} drink${igFollow.coveredCount === 1 ? '' : 's'})`}
          amountCents={-igFollow.amountCents}
          muted
        />
      )}
      {rewardDiscount > 0 && (
        <SummaryRow label="Reward discount" amountCents={-rewardDiscount} muted />
      )}
      {phSurcharge > 0 && (
        <SummaryRow
          label={`${PH_SURCHARGE.name} (${PH_SURCHARGE.percentage}%)`}
          amountCents={phSurcharge}
          muted
        />
      )}
      {platformFeeAmt > 0 && (
        <SummaryRow
          label={`${PLATFORM_FEE.name} (${PLATFORM_FEE.percentage}%)`}
          amountCents={platformFeeAmt}
          muted
        />
      )}
      {surcharge > 0 && (
        <SummaryRow
          label={`${CARD_SURCHARGE.name} (${CARD_SURCHARGE.percentage}%)`}
          amountCents={surcharge}
          muted
        />
      )}
      <View style={styles.summaryDivider} />
      <SummaryRow label="Total" amountCents={total} bold />
    </View>
  )
}
```

> Note: the variable shadow (`platformFee` is the imported helper name; we destructure as `platformFee: platformFeeAmt` to avoid collision). The Card Surcharge label is also de-hardcoded to use `CARD_SURCHARGE.name` and `CARD_SURCHARGE.percentage` from constants now that those exist.

- [ ] **Step 7: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Run all tests**

Run: `npx jest`
Expected: ALL PASS, including new surcharge tests + any pre-existing checkout tests.

- [ ] **Step 9: Commit**

```bash
git add app/checkout.tsx
git commit -m "feat(checkout): render Platform Fee row + thread amount through Apple/Google Pay total"
```

---

### Task B4: Version bump to 1.1.1 (build 12)

**Files:**
- Modify: `app.json` or `app.config.{js,ts}` (Expo config)
- Modify: `ios/mandysbubbleteaapp/Info.plist`
- Modify: `ios/mandysbubbleteaapp.xcodeproj/project.pbxproj`

> **CRITICAL:** Per project memory, do NOT run `expo prebuild --clean` — it will wipe manual iOS edits (CFBundleVersion, AppIcon flood-fill, TARGETED_DEVICE_FAMILY). Edit each file manually with sed/Edit.

- [ ] **Step 1: Locate the Expo version field**

Run:
```bash
ls /Users/stanyan/Github/mandys_bubble_tea_app/app.{json,config.js,config.ts} 2>/dev/null
```

Open whichever exists. Find `"version": "1.1.0"` and `"buildNumber": "11"` (or equivalent) and change to:

```json
  "version": "1.1.1",
  ...
  "ios": {
    "buildNumber": "12",
    ...
  }
```

- [ ] **Step 2: Update Info.plist**

Open `ios/mandysbubbleteaapp/Info.plist`. Find:

```xml
<key>CFBundleShortVersionString</key>
<string>1.1.0</string>
<key>CFBundleVersion</key>
<string>11</string>
```

Replace `1.1.0` → `1.1.1` and `11` → `12`.

- [ ] **Step 3: Update project.pbxproj**

Open `ios/mandysbubbleteaapp.xcodeproj/project.pbxproj`. Search for `MARKETING_VERSION = 1.1.0` and `CURRENT_PROJECT_VERSION = 11` (each may appear in multiple build configurations — Debug + Release).

Replace ALL occurrences:
- `MARKETING_VERSION = 1.1.0;` → `MARKETING_VERSION = 1.1.1;`
- `CURRENT_PROJECT_VERSION = 11;` → `CURRENT_PROJECT_VERSION = 12;`

Use sed to be safe:

```bash
sed -i '' 's/MARKETING_VERSION = 1\.1\.0/MARKETING_VERSION = 1.1.1/g' ios/mandysbubbleteaapp.xcodeproj/project.pbxproj
sed -i '' 's/CURRENT_PROJECT_VERSION = 11/CURRENT_PROJECT_VERSION = 12/g' ios/mandysbubbleteaapp.xcodeproj/project.pbxproj
```

- [ ] **Step 4: Verify all files updated**

```bash
grep -E "1\.1\.[01]|CFBundleVersion|CURRENT_PROJECT_VERSION|MARKETING_VERSION" \
  app.json app.config.* ios/mandysbubbleteaapp/Info.plist \
  ios/mandysbubbleteaapp.xcodeproj/project.pbxproj 2>/dev/null
```

Expected: every match shows 1.1.1 or 12; no remaining 1.1.0 or 11.

- [ ] **Step 5: Commit**

```bash
git add app.json app.config.* ios/mandysbubbleteaapp/Info.plist ios/mandysbubbleteaapp.xcodeproj/project.pbxproj 2>/dev/null
git commit -m "chore(release): bump 1.1.1 (build 12) — Platform Fee 0.4% breakdown"
```

---

### Task B5: RN verification + push + Archive

- [ ] **Step 1: Full type + test pass**

```bash
npx tsc --noEmit
npx jest
```

Expected: both PASS.

- [ ] **Step 2: Push main**

```bash
git push origin main
```

- [ ] **Step 3: Open Xcode → Clean Build Folder → Archive**

Per QUEUE notes:
1. Open `ios/mandysbubbleteaapp.xcworkspace` in Xcode 26
2. Cmd+Shift+K (Clean Build Folder) — kills any stale DerivedData from prior failed Archives
3. Product → Archive
4. Wait for Archive to complete; Distribute App → App Store Connect → Upload

- [ ] **Step 4: ASC create version 1.1.1**

In App Store Connect:
1. Create new version 1.1.1
2. Select uploaded build 12
3. What's New text: `Card surcharge breakdown updated.`
4. Submit for Review (other metadata copied from 1.1.0)

- [ ] **Step 5: Real-order smoke (after TestFlight build is processed)**

On the new TestFlight build:
1. Open app → add 1 cup → Checkout
2. Confirm SummaryBlock shows: Subtotal → (PH if today is a holiday) → Platform Fee (0.4%) → Card Surcharge (1.9%) → Total
3. Confirm Apple Pay sheet total === SummaryBlock Total (i.e. resolves the 1.0.8 cosmetic gap)
4. Place order → confirm Square Dashboard order detail shows three service-charge rows in PH/Platform/Card order
5. Confirm Square email receipt + POS ticket show three rows

If smoke passes, mark QUEUE tasks done:
- "App 端 RN 加 channel: app send" — unrelated, leave
- "1.0.8 surcharge 数学对齐 server" — DONE (closed by this build)
- "Platform Fee" rollout — DONE

---

## Closing Checklist

- [ ] Web spec `7e2ddc7` already on main; web implementation commits stacked on top
- [ ] Web tests added: 4 platformFee cases + complaint-mail fixture updated
- [ ] Web typecheck + test + build all green
- [ ] Web pushed to main → Vercel deployed → real-order smoke passed
- [ ] RN main checked out (not `feat/cup-label-app-doodle`)
- [ ] RN constants + helper + tests added
- [ ] RN checkout updated to use helpers + render Platform Fee row
- [ ] RN version bumped 1.1.1 (build 12) without `expo prebuild --clean`
- [ ] RN tsc + jest green
- [ ] RN pushed to main
- [ ] Xcode Archive uploaded to ASC, version 1.1.1 submitted for review
- [ ] TestFlight smoke passed (Apple Pay sheet === SummaryBlock Total — closes 1.0.8)
- [ ] QUEUE entries updated: Platform Fee → Recently Completed; 1.0.8 surcharge math → DONE
- [ ] HANDOFF entry written for next session
