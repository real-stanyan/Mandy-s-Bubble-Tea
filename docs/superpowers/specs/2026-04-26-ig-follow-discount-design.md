# Instagram Follow → 10% Off Design Spec

**Status:** Approved (2026-04-26)
**Author:** brainstorm session 2026-04-26
**Branch policy:** All commits go directly to `main` (no feature branch). User-specified.

---

## 1. Goal

Convert Instagram followers into registered Square customers by offering a one-time 10% off coupon claimable from `/account/promotions`. Activity is also intended to lift IG follower count.

**Primary KPI:** count of `ig_follow_discounts` rows minted in 30 days post-launch.
**Secondary KPI:** redemption rate (`redeemed_at IS NOT NULL` / total minted).

## 2. Non-Goals

- True follow verification (Instagram Graph API does not expose follow status to third parties for arbitrary users in 2026; Basic Display API is retired). This is an honor-system promo gated by per-customer dedup.
- Recurring discount / "permanent member" pricing — explicitly rejected during brainstorming.
- IG handle data collection — rejected for v1 (low operational value vs. friction cost).
- Home banner / first-load popup — out of scope for v1; revisit only if `/account/promotions` conversion is poor.
- Admin dashboard for tracking promo usage — `select` query in Supabase Studio is sufficient.
- Email / push notification on claim — welcome discount has no such notification; consistency.
- Cron job for expiry — promo never expires (Q6 decision).

## 3. Behavior Summary

### 3.1 Discount shape

- **Type:** percentage (10%)
- **Scope:** one drink (cheapest cup in the order at redemption time)
- **Redemption count:** 1 (single-use ticket)
- **Expiry:** none (matches existing welcome discount)
- **Claim eligibility:** any signed-in Square customer (new or existing). One ticket per customer, ever.

### 3.2 User flow

1. User visits `/account/promotions`.
2. Sees an "Instagram Follow" promo card in **Locked** state with two buttons:
   - **Step 1 — `Follow on Instagram`**: opens `https://instagram.com/mandysbubbletea` in a new tab. Click sets `localStorage.mbt.igFollowVisited = "1"`.
   - **Step 2 — `I followed — claim my 10% off`**: disabled until Step 1 was clicked. On click, calls `POST /api/promotions/ig-follow/claim` and refreshes `useAuth()` state. Card transitions to **Active** state.
3. With ticket Active, user adds drinks to cart. Cart drawer + checkout summary display `IG Follow 10%  −$X.XX` automatically (mirrors welcome discount auto-apply).
4. User completes payment. On `paymentStatus === "COMPLETED"`, `redeemed_at` is written and ticket transitions to **Redeemed** state. Card now shows strikethrough "Used".

### 3.3 Stacking with existing promotions

| Promo combo | Behavior |
|---|---|
| **Loyalty free redeem** (`applyLoyaltyReward = true`) | Skip both welcome and IG. Skip PH + card surcharge (existing pattern). IG ticket NOT consumed. |
| **Welcome 30% × 2 + IG 10%** (≥3 cups) | Welcome covers cheapest 2 cups; IG covers next-cheapest 1 cup. Both `OrderDiscount` rows attached. PH + card surcharge apply on post-discount base. |
| **Welcome only available + 1-cup order + IG ticket present** | Welcome takes the cup (more savings to user). IG ticket NOT consumed; carries over. |
| **Only IG available** | IG covers cheapest 1 cup. PH + card surcharge apply. |
| **No promo applicable** | No-op. IG ticket carries over. |

### 3.4 Edge case behaviors

- Guest visits `/account/promotions`: card shows Locked, Step 2 button text becomes `Sign in to claim`, links to `/auth?next=/account/promotions`.
- Two tabs claim simultaneously: DB primary key collision; one wins, the other receives `alreadyClaimed: true` (idempotent).
- Payment fails (`paymentStatus !== "COMPLETED"`): ticket preserved, no `redeemed_at` write. Mirror of welcome-discount fix `1eddeb8` (2026-04-25).
- Manager wants to comp a VIP an extra ticket: delete the row in Supabase Studio. User can re-claim. (Feature, not bug.)
- User unfollows on Instagram after claiming: not detected. Honor system bound; acceptable risk.

## 4. Architecture

### 4.1 Data model

New table `ig_follow_discounts`:

```sql
create table ig_follow_discounts (
  customer_id      text primary key,            -- Square customer id
  percentage       int not null default 10,
  drinks_remaining int not null default 1,
  claimed_at       timestamptz not null default now(),
  redeemed_at      timestamptz,
  created_at       timestamptz not null default now()
);
```

`customer_id` is foreign-keyed to nothing (matching `welcome_discounts`); cleanup is handled in `purgeAccount()`.

New RPC `consume_ig_follow_discount(p_customer_id, p_order_id, p_count)`:
Cloned from `consume_welcome_discount`. Atomically decrements `drinks_remaining`, writes `redeemed_at = now()` when ticket exhausted. Returns `{ consumed_count, drinks_remaining }`.

### 4.2 Backend modules

**`src/lib/ig-follow-discount.ts`** (new):
- `claimIgFollowDiscount(customerId)` — upsert insert with `ignoreDuplicates: true`. Returns `{ alreadyClaimed: boolean }`.
- `getIgFollowDiscountStatus(customerId)` — returns `{ available, percentage, drinksRemaining, claimedAt, redeemedAt }`. Disabled shape on error (never throws).
- `consumeIgFollowDiscount(customerId, orderId, count)` — wraps the RPC. Returns `{ consumedCount, drinksRemaining }`.

**`src/lib/promo-cup-pick.ts`** (new, refactor):
Extract welcome-discount cup-pick logic from `/api/orders` into a shared helper:
```ts
pickPromoCups({
  unitPrices: bigint[],
  welcomeK: number,
  igFollowK: number,
}): { welcomeCups: bigint[], igFollowCups: bigint[] }
```
- Sort `unitPrices` ascending.
- Welcome takes `slice(0, welcomeK)`.
- IG takes `slice(welcomeK, welcomeK + igFollowK)`.
- If `unitPrices.length < welcomeK + igFollowK`, IG gets fewer cups (potentially zero).
- **One-cup-with-welcome-priority rule:** if `unitPrices.length === 1 && welcomeK >= 1 && igFollowK >= 1`, return `{ welcomeCups: [unitPrices[0]], igFollowCups: [] }`. Caller treats this as "do not consume IG ticket".

**Caller contract:** `welcomeK` and `igFollowK` are the actual K values to attempt, derived from each promo's status — pass `0` when a promo is unavailable or `applyXxxDiscount` is false on the request body. `pickPromoCups` does not read promo status; it just allocates cups by sorted price.

The existing `/api/orders` welcome cup logic moves into this helper. `welcome-discount.test.ts` covers parity; new tests cover IG paths.

**`/api/orders/route.ts` changes:**
- Accept `body.applyIgFollowDiscount: boolean`.
- After computing welcome via existing path, call `getIgFollowDiscountStatus(customerId)`. If available and `applyIgFollowDiscount`, run the shared cup-pick helper, attach a second `OrderDiscount` (`uid: "ig-follow-discount"`, `type: "FIXED_AMOUNT"`, scope: `ORDER`), and write `metadata.igFollowDiscountDrinksCovered = String(K)`.
- Skip when `applyLoyaltyReward === true` (mirror welcome).

**`/api/payment/route.ts` changes:**
- After existing welcome consume, read `order.metadata?.igFollowDiscountDrinksCovered`. If present and `paymentStatus === "COMPLETED"`, call `consumeIgFollowDiscount(customerId, orderId, count)`. Log on consume.
- Include `igFollowDiscountConsumed: boolean` in success response (mirror welcome).

**`/api/me/route.ts` changes:**
- Add to the `Promise.all` fan-out: `getIgFollowDiscountStatus(customerId)`.
- Response shape gains `igFollowDiscount: { available, percentage, drinksRemaining }`.

**`/api/promotions/ig-follow/status/route.ts`** (new):
- GET. Reads Supabase session. 401 if no session. Calls `getIgFollowDiscountStatus`. Returns `{ available, percentage, drinksRemaining, claimedAt, redeemedAt }`.

**`/api/promotions/ig-follow/claim/route.ts`** (new):
- POST. Reads Supabase session → `customerId` via `user_profiles`. 401 if no session, 404 if profile missing.
- Calls `claimIgFollowDiscount(customerId)`. Returns `{ ok: true, alreadyClaimed: boolean }`.

**`src/lib/supabase.ts` `purgeAccount()` extension:**
- Add `delete from ig_follow_discounts where customer_id = ?` block. Mirror welcome cleanup pattern.

### 4.3 Frontend modules

**`src/components/auth/AuthProvider.tsx`:**
- Context shape adds `igFollowDiscount: { available, percentage, drinksRemaining }` and method `claimIgFollowDiscount(): Promise<{ alreadyClaimed: boolean }>`.
- `claimIgFollowDiscount()` POSTs `/api/promotions/ig-follow/claim`, then refreshes `/api/me`.

**`src/components/account/IgFollowPromoCard.tsx`** (new):
Three rendered states driven by `useAuth().igFollowDiscount`:
- **Locked** (`available === false && redeemedAt === null`): two buttons. Step 1 opens IG, sets `localStorage.mbt.igFollowVisited = "1"`. Step 2 disabled until visited; on click calls `claimIgFollowDiscount()`. Guest variant: Step 2 says "Sign in to claim" → `/auth?next=/account/promotions`.
- **Active** (`available === true`): brand-color card, ACTIVE pill, "10% Off Your Next Drink", "Auto-applied to your cheapest drink at checkout".
- **Redeemed** (`redeemedAt !== null` and not available): muted card, strikethrough title, "Thanks for following!".

**`src/app/account/promotions/page.tsx`:**
- Append IG entry to the `promotions` array.
- Render `IgFollowPromoCard` inline (not as a generic list item — it has its own state machine).

**`src/components/cart/CartDrawer.tsx`:**
- Read `igFollowDiscount` from `useAuth()`.
- When `available && lines.length > 0`, compute IG discount via `pickPromoCups` (client-side echo of server logic, same as welcome's existing pattern) and add `IG Follow 10%  −$X.XX` row to summary.
- Apple/Google Pay `paymentRequest.update({ total })` includes IG discount in total. Mirror cart-drawer wallet-refresh fix `dc5dba4` (2026-04-26).
- Submit body: include `applyIgFollowDiscount: igFollowDiscount.available`.

**`src/app/checkout/page.tsx`:**
- Same summary changes as CartDrawer, applied to mobile + desktop summary sites.
- Same wallet `paymentRequest` total update pattern.

### 4.4 Order discount math worked example

Order: 3 cups at $10, $8, $6. Welcome state: 2 drinks remaining at 30%. IG state: 1 drink remaining at 10%.

```
unitPrices sorted asc = [$6, $8, $10]   (in cents: [600n, 800n, 1000n])
welcomeK = 2 → welcomeCups = [600n, 800n]
igFollowK = 1 → igFollowCups = [1000n]

welcomeAmount   = (600 + 800) * 30 / 100 = 420  cents = $4.20
igFollowAmount  = 1000 * 10 / 100        = 100  cents = $1.00

OrderDiscounts attached:
  { uid: "welcome-discount",  amountMoney: 420,  type: FIXED_AMOUNT, scope: ORDER }
  { uid: "ig-follow-discount", amountMoney: 100, type: FIXED_AMOUNT, scope: ORDER }

Square subtotal phase math:
  pre-discount subtotal = 2400
  post-discount subtotal = 2400 - 420 - 100 = 1880
  PH surcharge (if active) = round-half-up(1880 * 0.10)  = 188  → 1880 + 188 = 2068
  Card surcharge          = round-half-up(2068 * 0.019)  = 39   → 2068 + 39  = 2107
  total = $21.07
```

Apple/Google Pay sheet must show $21.07 — wallet `paymentRequest.update({ total })` is mandatory before `tokenize()`.

## 5. Anti-abuse Model

| Risk | Mitigation |
|---|---|
| One person claims multiple times | `customer_id` PK + Square customer is phone-bound (one phone, one customer, one ticket) |
| Fake follow (clicked Step 1 without actually following) | Accepted (honor system) |
| Client forges `applyIgFollowDiscount` | `/api/orders` re-checks `getIgFollowDiscountStatus` server-side; missing ticket silently treated as "no discount" |
| Race: same ticket consumed twice | RPC is atomic |
| Payment failure burns ticket | `consume` only on `paymentStatus === "COMPLETED"` |
| User unfollows post-claim | Not detected; acceptable |

Excluded: IP rate limit, captcha, IG handle collection, admin dashboard.

## 6. Test Strategy

### Unit

- `src/lib/promo-cup-pick.test.ts` — welcome-only, IG-only, both-coexist, 1-cup welcome-priority rule, 0-cup edge, IG with empty unitPrices.
- `src/lib/ig-follow-discount.test.ts` — claim idempotency (double-claim returns `alreadyClaimed: true`), status disabled-shape on error, consume happy path + already-zero.
- `src/lib/welcome-discount.test.ts` — re-test after refactor confirms behavior parity.

### API integration (vitest with mocked Supabase admin)

- `src/app/api/promotions/ig-follow/__tests__/claim.test.ts` — 401 unauth, 404 missing profile, 200 first claim, 200 `alreadyClaimed: true` on second.
- `src/app/api/orders/__tests__/ig-follow.test.ts` — applyIgFollowDiscount with valid ticket attaches OrderDiscount; without ticket silently no-ops; both promos coexist correctly.
- `src/app/api/payment/__tests__/ig-follow.test.ts` — COMPLETED triggers consume; non-COMPLETED preserves ticket.

### Manual smoke (cmux browser + production sandbox)

1. Sign in as test user. Visit `/account/promotions` — Locked card visible.
2. Click Step 1 — IG opens. Return. Step 2 enabled.
3. Click Step 2 — card transitions to Active. `useAuth()` updates.
4. Add 2 cups to cart. CartDrawer shows IG row. Total math verified.
5. Apple Pay sheet on `localhost:3000` shows correct total (sandbox or production small order).
6. Place real small order. Square Dashboard order detail shows two `OrderDiscount` entries (if welcome also applied) or one IG entry.
7. Reload `/account/promotions` — card now Redeemed.
8. Reload `/account/promotions` — card stays in Redeemed state, no claim buttons. Then via DevTools fire POST `/api/promotions/ig-follow/claim` directly — response must be `{ ok: true, alreadyClaimed: true }` (idempotency contract).

### Stress harness extension

Add 3 scenarios to `feat/stress-test-payment` worktree (`/tmp/stress-test-wt`):
- IG-only single cup
- IG + welcome co-applied multi-cup
- IG + loyalty-free-redeem skip (verifies IG ticket NOT consumed)

Goal: 12 → 15 scenarios all green.

## 7. Files

**New (9):**

1. `supabase/migrations/<timestamp>_ig_follow_discounts.sql`
2. `src/lib/ig-follow-discount.ts`
3. `src/lib/ig-follow-discount.test.ts`
4. `src/lib/promo-cup-pick.ts`
5. `src/lib/promo-cup-pick.test.ts`
6. `src/app/api/promotions/ig-follow/status/route.ts`
7. `src/app/api/promotions/ig-follow/claim/route.ts`
8. `src/app/api/promotions/ig-follow/__tests__/claim.test.ts`
9. `src/components/account/IgFollowPromoCard.tsx`

**Modified (8):**

1. `src/app/account/promotions/page.tsx`
2. `src/app/api/orders/route.ts`
3. `src/app/api/payment/route.ts`
4. `src/app/api/me/route.ts`
5. `src/components/auth/AuthProvider.tsx`
6. `src/components/cart/CartDrawer.tsx`
7. `src/app/checkout/page.tsx`
8. `src/lib/supabase.ts` (extend `purgeAccount`)

Estimated 12-14 commits via subagent-driven flow.

## 8. Rollout

1. `git checkout main && git pull` — start from main HEAD (currently on `feat/delivery-auction`).
2. Apply Supabase migration in dev project, verify schema, then prod.
3. Push commits to main one task at a time. Vercel auto-deploys.
4. Manual smoke per Section 6.
5. Update DEV_QUEUE.md (Recently Completed) + DEV_HANDOFF.md.

**Rollback:** `git revert <range>` to main. Schema can stay (orphan table is harmless).

## 9. Open Questions / Future Work

- **Phase 2 home banner** — revisit after 30 days of `/account/promotions` data.
- **Phase 2 IG handle capture** — only if manual fraud review is ever requested by manager.
- **Phase 2 ManyChat / IG DM autoresponder integration** — only if honor-system fraud rate exceeds ~25% of mints (track via redemption-vs-follower-count delta).

## 10. Operational Notes

- Branch policy: all commits go directly to `main`. No feature branch.
- Honor system means each minted ticket = up to 10% of one drink in revenue at risk. Single-shop volume bounds the merchant's worst-case exposure.
- Promo never expires; manager can revoke individual tickets via Supabase Studio if abuse pattern emerges.
- Existing welcome-discount fix `1eddeb8` (only consume on `COMPLETED`) is a load-bearing precedent — IG must follow the same rule.
- Existing cart-drawer wallet refresh fix `dc5dba4` (`paymentRequest.update({ total })` before tokenize) is a load-bearing precedent — IG discount in cart must trigger the same update.
- Existing stress-harness math (Square SUBTOTAL_PHASE: round-half-up, post-discount surcharge base, percentage in `appliedMoney.amount`) applies; no new math, just extend scenario coverage.
