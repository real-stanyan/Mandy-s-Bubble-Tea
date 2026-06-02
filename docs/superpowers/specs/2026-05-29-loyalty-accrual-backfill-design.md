# Loyalty In-Store Accrual Backfill (Safety Net) — Design

**Date:** 2026-05-29
**Repo:** `mandys_bubble_tea` (web/backend)
**Status:** Approved by Stan, pending plan

## Problem

Staff report that scanning / entering a customer's phone at the counter
sometimes does **not** earn a star, even for registered customers who own a
valid loyalty account. Investigation against PRODUCTION Square (2026-05-29)
established the mechanism and ruled out other causes.

## Ground truth (verified against PRODUCTION Square + Supabase, 2026-05-29)

- **Loyalty program is healthy.** Program `cdb0ee64-…` is `ACTIVE`, 7
  CATEGORY-typed accrual rules (1 star each), 9-star reward tier. All 90
  catalog items belong to ≥1 accrual category (0 items earn nothing). Accrual
  events flow all day from both `SQUARE` (in-store Register) and `LOYALTY_API`
  (our web payment route) sources.
- **NOT the TOP 10 change.** Per-day miss-rate was already 7% on 2026-05-25,
  rising gently to ~12% on 05-29 — no cliff at any deploy. TOP 10 items still
  accrue (reporting category is an accrual category). The TOP 10 work was
  display-only and never mutated Square catalog.
- **Registered customers are enrolled.** 1298 `user_profiles`; the most recent
  300 real users were 100% phone-mapped to a loyalty account. The only 8
  without an account are `PWUser` (Playwright test) signups from 2026-05-19.
- **Root cause = independent Register actions.** On Square Register, "Add
  Customer" (sets `order.customer_id`) and "Loyalty phone check-in" (links the
  loyalty account to the order, which triggers accrual) are **two separate
  actions**. Proof: accrued POS order `…gf38YY` has `customer_id = NONE` yet
  earned a star (check-in without add-customer); missed orders (Jay, Lara,
  Kaho) have `customer_id` set but **no** accrual (add-customer without
  check-in). Variance is **per-transaction staff behavior**, not per-user.

### The four combinations

| Staff action | `customer_id` | Accrues? | |
|---|---|---|---|
| Check-in only | maybe absent | ✅ | e.g. `…gf38YY` |
| Add Customer only | present | ❌ | **the detectable miss we fix** |
| Both | present | ✅ | most orders |
| Neither | absent | ❌ | invisible miss (training only) |

## Goal

A backend safety net that detects paid orders with a customer attached but no
accrual, and backfills the star — idempotently, without ever double-accruing.
Closes the ~10% detectable leak regardless of staff workflow.

## Decisions (confirmed with Stan)

1. **Trigger:** any **paid** order (all sources, not just POS) with a
   `customer_id` and **no existing accrual** for that order → backfill.
2. **Unregistered walk-ins:** if the attached customer has a phone but **no**
   loyalty account, **enroll** (`findOrCreateLoyaltyAccount`) then accrue —
   mirrors the web app's own enrollment philosophy.
3. **Mechanism:** all three, sharing one idempotent backfill function —
   webhook (primary, fast) + cron sweep (catches missed webhooks) + one-time
   30-day retroactive script.
4. **Retroactive scope:** last 30 days, **dry-run report first**, apply only
   after Stan confirms the count.
5. **Timeliness:** star should land within ~5 minutes via the webhook path.

## Architecture

### Core: `backfillAccrualForOrder(orderId, source)` — `src/lib/loyalty-backfill.ts`

Single idempotent entry point used by all three paths. Returns a result enum
(`accrued` | `already` | `skipped`, with reason). Steps:

1. `orders.get(orderId)`; require `COMPLETED` + a real settled tender (reuse
   `isRealPaymentTender` from `src/lib/square-order.ts`). Else → `skipped:not_paid`.
2. No `customer_id` → `skipped:no_customer` (the invisible 4th case).
3. **Already-accrued check** — `searchEvents({ orderFilter: { orderId },
   typeFilter: { types: ["ACCUMULATE_POINTS"] } })`. Any hit → `already`.
4. Resolve the customer's phone (from the Square customer record). No phone →
   `skipped:no_phone`.
5. `findOrCreateLoyaltyAccount(customerId, phoneE164)` — enrolls if missing.
6. `accrueForOrder(accountId, orderId)` with a **stable idempotency key
   `backfill:${orderId}`** (not `randomUUID`).
7. Record in `loyalty_backfill_log` (insert on conflict do nothing).

All errors are caught and logged; callers never fail their host request.

### Idempotency — defense in depth

| Layer | Mechanism |
|---|---|
| L1 | Supabase `loyalty_backfill_log` unique(`square_order_id`); claim before accrue (same pattern as `print_jobs` / `claimOrderPushSlot`). |
| L2 | `searchEvents(orderFilter)` precheck — skip if Square POS (or we) already accrued. |
| L3 | Stable idempotency key `backfill:${orderId}` — our own retries deduped by Square. |
| L4 | **Time gate** — only process orders old enough that Square's own check-in accrual has settled. Webhook → QStash delay ~5 min; cron → only scan orders in [now−60min, now−10min]. |

**Known blind spot (accepted):** ~2% of `SQUARE` accrual events carry no
`orderId` (manual adjusts / non-order check-ins), invisible to L2. Order-tied
accruals empirically always carry `orderId` (49/49 sampled), so residual
double-accrual risk is tiny; L1 still prevents our own repeats. Documented, not
engineered around.

### Path 1 — Webhook (primary)

In the existing `handleOrderPaid` (`order.updated`) handler: if the order has a
`customer_id`, publish a **QStash job delayed ~5 min** to a new worker route
`/api/loyalty/backfill-worker`. The worker verifies the QStash signature
(`Receiver`, reusing the wallet-push pattern) and calls
`backfillAccrualForOrder(orderId, "webhook")`. QStash retries (3) cover
transient failures.

### Path 2 — Cron sweep (safety net)

New route `/api/cron/loyalty-backfill-sweep` + `vercel.json` cron every 15 min.
Scans orders created in [now−60min, now−10min] (paginated), and for each
paid order with a `customer_id` not already in `loyalty_backfill_log` and not
accrued, calls `backfillAccrualForOrder(orderId, "cron")`. Protected by the
Vercel cron auth header. Optional hardening: GitHub Actions backup trigger
(per the known Vercel-cron-silent-skip risk).

### Path 3 — Retroactive script

`scripts/backfill-loyalty-30d.mjs`, reusing the same logic. Default dry-run:
reports count + sample of orders that would be backfilled. `--apply` performs
the backfill. Run only after Stan confirms the dry-run numbers.

### Wallet pass refresh (free)

Accrual fires Square's `loyalty.account.updated` webhook → the existing
`handleLoyaltyBalanceUpdate` pushes the Apple Wallet pass update. Stars refresh
automatically; no extra code.

## Data model

New table `loyalty_backfill_log` (Supabase, prod via migration):

- `square_order_id text PRIMARY KEY`
- `loyalty_account_id text not null`
- `points int`
- `source text` — `'webhook' | 'cron' | 'retro'`
- `created_at timestamptz default now()`

## Error handling

- Every path swallows + logs errors; webhook/cron always return 2xx so Square /
  Vercel don't spin on retries.
- QStash worker returns 2xx on handled outcomes; non-2xx only on unexpected
  errors so QStash retries.
- Ledger insert-on-conflict is the hard stop against duplicates.

## Testing (TDD)

Unit tests for `backfillAccrualForOrder` with mocked Square SDK + Supabase:

- not paid → `skipped:not_paid`
- no customer → `skipped:no_customer`
- already accrued (searchEvents returns an event) → `already`
- no loyalty account + phone → enroll then accrue
- existing account → accrue
- ledger conflict (already backfilled) → `skipped:already_logged`
- stable idempotency key is `backfill:${orderId}` (not random)

Webhook worker + cron route: thin integration tests around signature/auth
gating and that they delegate to the core function.

## Out of scope

- The invisible 4th case (member, but staff did neither action) — undetectable
  from order data; staff-training matter, noted not solved.
- Partial-refund star clawback — already handled by `reverseAccrualForOrder`.
- Changing the Square Register staff workflow.
