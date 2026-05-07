# Multi-Cup Loyalty Reward Redemption — Design

**Date**: 2026-05-07
**Scope**: web (`mandys_bubble_tea`) + app (`mandys_bubble_tea_app`) checkout, shared `/api/loyalty/redeem` endpoint
**Status**: design approved, awaiting plan

## Problem

Today a customer with 18+ stars at checkout can only redeem **one** free drink — the toggle is a boolean and the server creates exactly one Square loyalty reward per call. Customers who saved up multiple reward tiers (18 / 27 / 36 stars) have to either spread the redemptions across multiple orders or burn the surplus stars indefinitely. Owner wants the option to apply multiple free drinks to the same order.

## Goals

- Allow `N` reward redemptions on a single order, capped by `min(floor(stars / starsPerReward), cupCount)`.
- Stay opt-in (default 0 redemptions) so a customer with 18 stars who didn't notice the stepper still pays normally and keeps both reward tiers.
- Combine cleanly with the existing welcome / IG-follow promotions: rewards eat the cheapest cups first, the leftover cups stay eligible for welcome / IG.
- Keep server-side state consistent — partial redemption is never persisted.

## Non-Goals

- No change to Square Loyalty program configuration (still 9 stars = 1 free drink, single tier).
- No change to accrual logic (cup-count → stars after payment).
- No "partial cash + partial reward" hybrid.
- IG-follow ↔ welcome mutual exclusion stays as-is. The new combinatorial rule is only `reward × welcome` and `reward × IG`.

## Approach summary

Single round-trip server endpoint accepting `{ orderId, count: N }`, server loops `loyalty.rewards.create` N times against the same order id and rolls all of them back if any one fails. Both clients gain a stepper UI replacing the current boolean toggle. The shared `pickPromoCups` helper grows a `loyaltyRewardCount` parameter so that the cheapest-N cups are removed from the welcome / IG candidate set.

## Shared business rules

- **Reward count cap**: `maxRewardCount = min(floor(loyaltyBalance / starsPerReward), totalCupCount)`. Cup count = sum of `quantity` across all cart lines (each cart line can hold a quantity > 1; one cup = one reward redemption).
- **Reward discount math**: expand all cart lines into a flat array of per-cup unit prices, sort ascending, sum the first `rewardCount` entries. Mirrors how Square's "Free Drink of Your Choice" reward picks the cheapest applicable item.
- **Promo coverage with rewards**: `pickPromoCups({ unitPrices, welcomeK, igFollowK, loyaltyRewardCount })` first does `sorted.slice(loyaltyRewardCount)` to remove the reward-covered cups, then runs the existing welcome-wins-over-IG logic on the remainder. No change to welcome ↔ IG mutual exclusion.
- **isFreeRedeem**: `subtotal - rewardDiscount - welcomeDiscount - igDiscount + surcharges == 0`. Triggered when N == cupCount AND the cheapest-N covers full subtotal (i.e., promos won't push the rest below zero, which is impossible because rewards already consumed those cups). Server skips the card surcharge service charge; clients skip Apple Pay sheet entirely (existing $0-redeem code path).

## Server contract — `POST /api/loyalty/redeem`

### Request

```ts
{
  orderId?: string,           // unchanged
  count?: number              // NEW — defaults to 1 for backward compat
}
```

### Response

```ts
// Breaking field rename: loyaltyRewardId → loyaltyRewardIds (array)
{
  ok: true,
  loyaltyRewardIds: string[],
  remainingBalance: number,
  updatedAmountCents: string | null
}
```

Both clients are owned by us — we update both at the same time, no compatibility shim needed.

### Validation order

1. Auth (existing): `getAuthedUser` + phone present.
2. Body: `count` is integer, defaults to 1, `1 <= count <= 10` (10 is a hard safety cap to bound damage from a malformed client).
3. Account lookup (existing): `findLoyaltyAccountByPhone` — no implicit create.
4. Balance check: `account.balance >= starsPerReward * count`. Error message includes both numbers.
5. If `orderId` provided: `squareClient.orders.get({ orderId })` once, compute `cupCount = sum(lineItems.quantity)`. Reject `count > cupCount` with `"Cannot redeem N rewards on M-cup order"`.

### Loop + rollback

```ts
const createdIds: string[] = [];
let updatedAmountCents: string | null = null;
try {
  for (let i = 0; i < count; i++) {
    const { loyaltyRewardId } = await redeemReward(account.accountId, rewardTierId, orderId);
    createdIds.push(loyaltyRewardId);
  }
  if (orderId) {
    // Refetch lives inside the same try so a failed refetch also triggers
    // rollback — otherwise the client would have no updatedAmountCents but
    // the rewards would still be live on the order.
    const refetched = await squareClient.orders.get({ orderId });
    updatedAmountCents = refetched.order?.totalMoney?.amount?.toString() ?? null;
  }
} catch (err) {
  // Rollback every reward we created — points return to the account
  // automatically and the order's discount lines vanish.
  await Promise.allSettled(
    createdIds.map(id => squareClient.loyalty.rewards.delete({ rewardId: id }))
  );
  // Log if any rollback delete itself fails so we can manual-fix in Square Dashboard.
  // Re-throw the original error so the client sees a single 502.
  throw err;
}
```

Order is refetched **once** after the loop succeeds (not after each create) — saves N-1 round trips and avoids race against Square's order recalc.

## Web checkout (`src/app/checkout/page.tsx`)

State change:
```ts
// before
const [useReward, setUseReward] = useState(false);

// after
const [rewardCount, setRewardCount] = useState(0);
```

Derived:
```ts
const maxRewardCount = useMemo(() => {
  if (starsPerReward <= 0) return 0;
  const cupCount = lines.reduce((n, l) => n + l.quantity, 0);
  return Math.min(Math.floor(loyaltyBalance / starsPerReward), cupCount);
}, [loyaltyBalance, starsPerReward, lines]);

const sortedUnitPrices = useMemo(() => { /* expand + sort ascending */ }, [lines]);

const rewardDiscount = useMemo(
  () => sortedUnitPrices.slice(0, rewardCount).reduce((s, p) => s + p, 0n),
  [sortedUnitPrices, rewardCount],
);
```

`pickPromoCups` call gains `loyaltyRewardCount: rewardCount`. `displayTotal` arithmetic stays the same shape — just uses the new `rewardDiscount`. Apple Pay paymentRequest amount and the existing surcharge-skip path follow the same `displayTotal` value.

Redeem call:
```ts
await fetch("/api/loyalty/redeem", {
  method: "POST",
  body: JSON.stringify({ orderId, count: rewardCount }),
});
```

Sentinel: `if (rewardCount === 0) skip /api/loyalty/redeem entirely`.

UI replaces the current "Use a reward" toggle row with a stepper:
- Layout: same row, left side label "Use rewards", right side `[−] N [+]` controls + below-line caption `−$X.XX off N cheapest drink${N>1?'s':''}`.
- `[−]` disabled when `rewardCount === 0`. `[+]` disabled when `rewardCount === maxRewardCount`.
- When `loyaltyBalance < starsPerReward`: hide the stepper entirely (current behavior — no row shown).
- Order summary line: rendered when `rewardCount > 0` as `Loyalty reward ×N    −$X.XX`.

## App checkout (`app/checkout.tsx`)

Mirrors web. Replaces the boolean `useReward` toggle with a Pressable stepper. New helper in `lib/cart-promo.ts` (parallel to web's `lib/promo-cup-pick.ts`):

```ts
export function sumOfCheapestN(items: { price: number; quantity?: number }[], n: number): number {
  // expand quantity into per-cup, sort ascending, sum first n
}
```

`usePayment` hook redeem step changes:
```ts
const redeemRes = await apiFetch<RedeemResponse>('/api/loyalty/redeem', {
  method: 'POST',
  body: JSON.stringify({ orderId, count: rewardCount }),
});
```

UI: row with `<Pressable>−</Pressable> {rewardCount} <Pressable>+</Pressable>` + caption. Disabled state styling identical to web (opacity 0.4 + pointerEvents none).

## Shared lib changes

### `src/lib/promo-cup-pick.ts`

```ts
export interface PickPromoCupsArgs {
  unitPrices: bigint[];
  welcomeK: number;
  igFollowK: number;
  loyaltyRewardCount?: number;  // NEW, defaults to 0
}
```

Implementation:
```ts
export function pickPromoCups(args: PickPromoCupsArgs): PickPromoCupsResult {
  const sorted = [...args.unitPrices].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const remaining = sorted.slice(args.loyaltyRewardCount ?? 0);
  // existing welcome-wins-over-IG logic, but operating on `remaining` not `sorted`
  ...
}
```

Default of `0` means existing callers keep working unchanged — feat/cup-label-tsp100 PR #4 will rebase cleanly.

### `src/app/api/loyalty/redeem/route.ts`

See server contract above.

### `src/lib/loyalty.ts`

`redeemReward` is unchanged — kept as a single-reward primitive. The route handler does the looping + rollback.

## Failure handling

| Failure mode | Response | UI |
|---|---|---|
| Server validation (count out of range, count > cupCount) | 400 | Toast "Invalid reward count" — should never happen if client is correct, but surface plainly |
| Balance insufficient | 400 | Toast with server message ("Not enough stars — you have X, need Y") |
| Square `loyalty.rewards.create` fails mid-loop | 502 after rollback | Toast "Reward redemption failed, please try again" — `rewardCount` state preserved so user can retry |
| Rollback delete itself fails | 502 + server log `[loyalty-rollback-failed]` with reward IDs | Same toast as above; admin manually deletes from Square Dashboard |
| Order refetch fails after successful loop | 502 + log | Same toast; rewards were created but client doesn't get `updatedAmountCents` — `placeOrder` should retry the redeem step (rollback fires, retry creates fresh rewards) |

Critical UI invariant: `placeOrder` must abort the entire flow if redeem returns non-200 — never proceed to payment with a `rewardCount > 0` and an unredeemed reward, otherwise customer pays full price thinking they got a discount.

## Tests

### Unit
- `pickPromoCups` (web) — add 6 cases:
  1. `loyaltyRewardCount=0` (no change to existing behavior)
  2. `loyaltyRewardCount=1` + welcome=1: reward eats cheapest, welcome eats next-cheapest
  3. `loyaltyRewardCount=2` + IG=1: two cheapest become reward cups, third-cheapest is IG
  4. `loyaltyRewardCount` ≥ `unitPrices.length`: welcome / IG return empty arrays
  5. `loyaltyRewardCount=1` + welcome=1 + IG=1: reward + welcome wins (IG empty per existing rule)
  6. `loyaltyRewardCount=cupCount` + welcome=1: welcome empty (no cups left)
- New `sumOfCheapestN` (app) — 4 cases: empty cart, n=0, n>cupCount clamps, multi-quantity expansion
- `redeem` route — 6 cases: count=2 happy path / count=0 reject / count=11 reject / count=2 with cupCount=1 reject / Square 5xx mid-loop triggers rollback / rollback delete failure logs but still 502s

### Integration
- Web `surcharge.test.ts`: rewardCount=2, 3 cups, welcome=1 — expected total math is `(c1+c2+c3) - (c1+c2) - 0.30*c3 + surcharges` (where c1≤c2≤c3)
- App `surcharge.test.ts`: same cases mirrored

### Manual e2e (after deploy)
- Sandbox: account with 18 stars + 3-cup cart → stepper shows max 2 → place order → Square Dashboard order shows 2 separate Discount lines, Loyalty events show 2 REDEEM_REWARD entries, account balance drops by 18.
- Sandbox: account with 27 stars + 3-cup cart → stepper shows max 3 → choose 3 → `displayTotal == surcharges` only → Apple Pay sheet does NOT appear → submitted as $0-redeem path → loyalty events show 3 REDEEM_REWARD.
- Sandbox: 18 stars + 3 cups + welcome available → reward=2 → expect welcome to apply to the third cup at 30% off; toggle reward=0 → welcome should still apply (covering cheapest cup as today).

## Open questions answered during brainstorm

- **UX shape**: stepper (Q1=B)
- **Default value**: 0, opt-in (Q2=A)
- **Promo conflict**: relay — reward eats cheapest N, welcome / IG take leftovers (Q3=B)
- **Server contract**: server-side loop, single round trip (Q4=A)
- **Failure mode**: all-or-nothing rollback (Q5=A)

## Risks & mitigations

- **Square rate limit on `loyalty.rewards.create` loop**: 10-cap on `count` keeps worst case at 10 sequential calls; Square's published RPS is well above this. If it ever bites we can switch to `Promise.all` (Square idempotency keys make parallel safe) but sequential is simpler and avoids ambiguous partial-success states.
- **Rollback delete fails**: logged with reward IDs so admin can manually clean in Square Dashboard. Square's `loyalty.rewards.delete` is idempotent and rarely fails — accepted residual risk.
- **Backward compat with old clients**: response field rename `loyaltyRewardId` → `loyaltyRewardIds`. Both clients (web + app) are shipped together; no third-party caller.
- **Multi-tap UI race**: stepper `[+]` clicked rapidly could send count beyond max if state updates batch incorrectly. Use `setRewardCount(n => Math.min(n + 1, maxRewardCount))` functional updater on both platforms.
