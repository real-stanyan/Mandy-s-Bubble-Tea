# Platform Fee (0.4%) Design Spec

**Status:** Approved (2026-04-29)
**Author:** brainstorm session 2026-04-29
**Branch policy:** All commits (spec + implementation) go directly to `main` in both web and RN-app repos. User-specified 2026-04-29, mirroring the IG follow discount precedent. RN app changes ship together with the next iOS build (1.1.1 build 12).

---

## 1. Goal

Add a third online-order pass-through service charge of **0.4%** named **Platform Fee** that customers see explicitly on the cart, checkout summary, Apple Pay sheet, Square Dashboard, automated Square email receipts, and POS printed receipts. This sits alongside the existing 1.9% Card Surcharge and 10% Public Holiday surcharge.

**Why:** owner wants to recover an additional 0.4% online-ordering platform cost without shrinking already-thin per-cup margin. The fee is real and is added to the customer charge — it is **not** a hidden internal accounting line.

## 2. Non-Goals

- Hiding any portion of the fee from customers. Earlier brainstorm explicitly rejected the "display 1.9% but charge 2.3%" path: misleading-pricing risk under ACL s18 + RBA Surcharging Standard, and technically infeasible given Square Dashboard / email receipts / Apple Pay sheet expose the real `serviceCharges` percentage anyway.
- Bundling the new fee into the existing 1.9% Card Surcharge as a single combined "2.3%" line. User chose to display both lines transparently.
- Changing per-item menu prices.
- Refactoring or replacing existing PH or Card Surcharge logic. Platform Fee is a third entry that mirrors the existing pattern.
- Discounting Platform Fee against welcome / IG follow / loyalty redemptions (other than the existing whole-order skip when a loyalty reward fully covers the order).

## 3. Behavior Summary

### 3.1 Fee shape

| Property | Value |
|---|---|
| Display name | `Platform Fee` |
| Percentage | `0.4` (string, mirrors `OrderServiceCharge.percentage` Square contract) |
| BPS for BigInt math | `40n` (`PLATFORM_FEE_BPS`) |
| Calculation phase | `SUBTOTAL_PHASE` (computed on **pre-discount** subtotal — same as PH and Card Surcharge) |
| Taxable | `false` (menu items are GST-inclusive; pass-through fees are not double-taxed) |
| Skipped when | `body.applyLoyaltyReward === true` (free-redeem path skips all three service charges — no card charged means nothing to pass through) |

### 3.2 Surcharge ordering

Three service charges are pushed onto the Square `orderServiceCharges` array in this order, which is also the order they appear on the customer's cart drawer, checkout summary, Square Dashboard order detail, automated email receipt, and POS printed receipt:

1. **Public Holiday surcharge** (10%, only on PH dates) — government-mandated context, listed first
2. **Platform Fee** (0.4%) — online-ordering platform pass-through, listed second
3. **Card Surcharge** (1.9%) — payment-method pass-through, listed third

Mental model: external context (government) → platform context → payment method.

### 3.3 Math

`platformFee(subtotalCents: bigint): bigint = (subtotalCents * 40n) / 10000n`

BigInt floor truncation, mirroring the existing `cardSurcharge` helper exactly. Square's authoritative `totalMoney` is calculated server-side from `percentage: "0.4"` using round-half-up, so client-side display may differ from real charge by ≤1 cent at some price points. Apple Pay sheet always shows true `totalMoney`, so the customer is never charged more than the displayed total at the point of payment.

The RN app currently uses `Math.floor` on a pre-discount base for Card Surcharge (QUEUE task "1.0.8 surcharge 数学对齐 server"). This spec resolves that task by switching the RN app's surcharge helpers (all three: PH, Platform, Card) to `Math.round` on pre-discount base, which matches the server's SUBTOTAL_PHASE round-half-up behavior. Web BigInt helpers stay floor (existing behavior; the ≤1-cent display drift is acceptable since Apple Pay sheet is always authoritative).

### 3.4 Stacking with existing promotions

| Scenario | Service charges attached |
|---|---|
| Loyalty reward fully covers order (`applyLoyaltyReward = true`) | None (all three skipped) |
| Welcome discount + non-PH day | `[Platform Fee, Card Surcharge]` — both calculated on pre-discount subtotal |
| IG follow discount + non-PH day | `[Platform Fee, Card Surcharge]` |
| Public holiday + welcome discount | `[PH (Holiday name), Platform Fee, Card Surcharge]` |
| Plain order, non-PH | `[Platform Fee, Card Surcharge]` |

`SUBTOTAL_PHASE` ensures all three pass-through fees are computed on the pre-discount subtotal so welcome / IG / loyalty discounts don't shrink the surcharge base.

## 4. Architecture / Code Changes

### 4.1 Web (`~/Github/mandys_bubble_tea`, branch `feat/platform-fee` from `main`)

**`src/lib/constants.ts`** — append after the existing `CARD_SURCHARGE_BPS` block (and before the PH section so all card-related constants are grouped):

```ts
export const PLATFORM_FEE = {
  name: "Platform Fee",
  percentage: "0.4",
} as const;

/** 0.4% as basis-points-per-10000 for BigInt math: 40 / 10000. */
export const PLATFORM_FEE_BPS = 40n;
```

**`src/store/cart.ts`** — add `platformFee()` helper directly after `cardSurcharge()`, mirroring its shape (BigInt, floor truncation, kept in sync with `PLATFORM_FEE_BPS`):

```ts
export function platformFee(subtotalCents: bigint): bigint {
  return (subtotalCents * PLATFORM_FEE_BPS) / 10000n;
}
```

**`src/app/api/orders/route.ts`** — between the PH push block and the Card Surcharge push block, push the Platform Fee entry. Wrap inside the same `if (!skipSurcharges)` guard. UID `platform-fee`.

**`src/components/cart/CartDrawer.tsx`** — add `platformFeeAmount` memo, `effectivePlatformFee` (skipped on free-redeem), Apple Pay paymentRequest amount calculation includes platformFeeAmount, render new line between PH row and Card Surcharge row, pass `platformFeeAmount` prop to footer subcomponent.

**`src/app/checkout/page.tsx`** — same shape: `platformFeeAmount`, `effectivePlatformFee`, total math, render row in both the cart-drawer-summary block (line 749-764 region) and the checkout-page-summary block (line 991-1006 region), update footer "Incl." line from 2-segment to 3-segment.

**`src/lib/email/complaint-mail.ts`** + **`src/lib/email/complaint-mail.test.ts`** — extend `totalsLine` to include `Platform 0.4% $X.XX` segment between the PH and Card segments. Update fixture string at `complaint-mail.test.ts:17`.

### 4.2 RN App (`~/Github/mandys_bubble_tea_app`, branch sibling cut from `main`)

Mirrors web changes:
- `lib/constants.ts` — same `PLATFORM_FEE` + `PLATFORM_FEE_BPS`
- `lib/surcharge.ts` (or wherever the helper lives) — add `platformFee()`
- `app/checkout.tsx:179-186` — add Platform Fee to surcharge stack; **also fix existing surcharge math for all three lines**: switch `Math.floor` → `Math.round` (matching Square SUBTOTAL_PHASE round-half-up). This resolves the QUEUE-tracked 1.0.8 task in the same release.
- Summary renders three rows in PH → Platform → Card order
- Apple Pay paymentRequest amount includes platformFee

**Version bump:** **1.1.1 (build 12)**. ASC What's New: "Card surcharge breakdown updated."

### 4.3 Branch coordination

- All commits go directly to `main` in both repos (no feature branch per user preference).
- The currently checked-out web branch `feat/cup-label-tsp100` (PR #4 draft) is unrelated and must not pick up Platform Fee work — Platform Fee commits land on `main` while PR #4 stays on its own branch.
- The QUEUE-tracked RN-app branch `feat/cup-label-app-doodle` (11 commits behind main) must rebase / merge main before shipping, or the doodle build will lack Platform Fee.

## 5. Tests

### 5.1 Web (vitest)

- **`src/store/__tests__/surcharge.test.ts`** — new `platformFee()` describe block with cases:
  - `platformFee(620n) === 2n` (0.4% of $6.20 = 0.0248 → floor 2)
  - `platformFee(0n) === 0n`
  - `platformFee(1_000_000n) === 4000n` ($10,000 edge case)
  - Existing `cardSurcharge` cases preserved
- **`src/lib/email/complaint-mail.test.ts`** — fixture string updated to 5-segment `Subtotal · PH · Platform · Card · Total`
- New integration test (`src/app/api/orders/route.test.ts` if it exists, otherwise add): mock orders.create call and assert
  - `applyLoyaltyReward: true` → `serviceCharges` is `undefined` (existing behavior preserved)
  - non-PH plain order → `serviceCharges` array is `[platform-fee, card-surcharge]`
  - PH date plain order → `[public-holiday-surcharge, platform-fee, card-surcharge]`

### 5.2 RN app (jest)

- `lib/surcharge.test.ts` (or equivalent) — `platformFee()` cases
- Checkout total computation test covering 3-row breakdown

### 5.3 Stress-test sandbox (`feat/stress-test-payment` worktree at `/tmp/stress-test-wt`)

Run `npm run stress:server` + `npm run stress:run` against the new branch in Square sandbox. The 12 existing scenarios stay intact; verify:
- Welcome discount + plain → `[platform-fee, card-surcharge]`, both bases use pre-discount subtotal
- Loyalty reward all-covers → `serviceCharges` empty
- PH + welcome (use a PH date in `PUBLIC_HOLIDAYS_2026`) → 3-entry array, correct order
- Modifier qty>1 (Pearl ×2 dedupe scenario) → unrelated; should not interact

### 5.4 Real-order production smoke

After deploy, in this order:
1. Web small order (1 cheapest cup) → verify cart drawer shows 3 rows + checkout summary 3 rows + Apple Pay sheet total = displayed total + Square Dashboard order detail lists 3 service charges in PH/Platform/Card order + Square automated email receipt lists 3 lines
2. App small order (after iOS build 12 ships TestFlight) → same checks; specifically verify summary footer total === Apple Pay sheet total (closes 1.0.8 cosmetic gap)
3. Next public holiday (2026-05-04 Labour Day) → repeat with PH active; non-blocking, can be backfilled

## 6. Compliance Notes

- **ACL s18 (misleading conduct):** displayed total === actual charged total at all surfaces (web, app, Apple Pay sheet, Square email, POS receipt). No hidden fee.
- **RBA Surcharging Standard:** Card Surcharge stays at 1.9% (within Square's documented cost-of-acceptance for online card-not-present). Platform Fee is named "Platform Fee" not "Card Surcharge", so it is not regulated under the card-payment-surcharge rule and is permitted as a generic service charge with full disclosure.
- **Square Merchant Agreement:** Platform Fee is attached as a normal `OrderServiceCharge` with a clear name and percentage — Square's standard pass-through pattern. No ToS conflict.

## 7. Rollout

1. Implement web changes + tests on `main`; run `npm run typecheck && npm run test && npm run build`; commit and push.
2. Vercel auto-deploys main to production.
3. Web real-order smoke (step 5.4 #1).
4. Implement RN-app changes on `main` (separate repo) including `Math.floor` → `Math.round` fix on all three surcharge lines.
5. Bump app to 1.1.1 (build 12); Xcode Archive → ASC; submit for review with What's New "Card surcharge breakdown updated."
6. App real-order smoke once TestFlight build is available (step 5.4 #2).
7. PH smoke at next public holiday opportunity (step 5.4 #3).

## 8. Open Questions

(none — all clarifying questions answered during brainstorm)
