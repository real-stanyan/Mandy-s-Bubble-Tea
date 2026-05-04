# App Lottery Prize — Design Spec

**Date**: 2026-05-04
**Status**: Draft (awaiting user approval)
**Scope**: cross-repo (mandys_bubble_tea / mandys_bubble_tea_app / mandys_bubble_tea_admin)

## Summary

Add an **app-only** time-bounded lottery campaign feature: every successful app
order during an active campaign window triggers a server-side weighted-random
prize roll. Result is revealed immediately on the order-confirmation page
through a confetti modal. Digital prizes auto-apply on the user's next app
order. Physical prizes show a 6-character claim code + QR for in-store
verification. Per-user cap: physical prizes are limited to 1 win per campaign;
digital prizes and "thank-you" outcomes are unlimited.

The feature is positioned as a perk for installing the app, complementing the
existing Square Loyalty (1 drink = 1 star, 9 stars = free drink),
`welcome_discounts` (first-order 30% off), and `ig_follow_discounts` channels
without overlapping with any of them.

## Goals

- Reward app users with a moment of variable-ratio "open the box" delight on
  every order, driving retention and reorder behavior.
- Keep the operational surface tiny for V1: one active campaign at a time,
  config-driven via SQL migration; admin gets a read-only winners page for
  in-store claim verification.
- Reuse existing infrastructure: Square `OrderLineItemDiscount`/modifier
  injection (same pattern as `welcome_discounts`), Supabase row-gating, Square
  webhook for refunds.

## Non-Goals (Out of Scope for V1)

- Multiple concurrent campaigns. One at a time.
- Self-service campaign CRUD in admin. Mandy does not author campaigns; new
  campaigns ship via SQL migration.
- Email/SMS/push notification delivery of prize results. Confetti modal is the
  only reveal channel.
- Standalone "My Prizes" tab. Active prizes live as a section inside Account.
- Marketing analytics (heatmap, conversion lift, win-rate dashboards).
- "Almost won" near-miss messaging.
- Multiple physical prize tiers. V1 ships one physical prize (sticker) at 10%.
- Stacking digital coupons on a single order. One-coupon-per-order policy.
- Push reminders for soon-to-expire prizes.
- Web (mandybubbletea.com) eligibility. Web orders are excluded by design.
- User-entered promo codes.

## Decisions

| Dimension | Decision |
|-----------|----------|
| Code semantics | Time-bounded campaign code (campaign window gate) |
| Eligibility channel | App-only (web orders excluded) |
| Prize reveal timing | At order time (server rolls during `/api/orders` POST) |
| Per-user cap | Physical: 1 per campaign; Digital: unlimited; Thank-you: unlimited |
| Campaign management | Config-driven via Supabase migration; admin read-only winners page |
| Trigger threshold | None — every successful app order rolls |
| Lifecycle | Physical: 7-day claim window; Digital: 30-day redemption window; Thank-you: stateless |
| Refund behavior | Refund of the trigger order voids the prize and releases the physical-cap lock |
| Reveal UX | Full-screen confetti modal with three variants (thank-you / digital / physical) |
| Digital redemption | Auto-apply on next app order (no manual claim step) |
| Multiple active digital prizes | Single-coupon policy — apply earliest-expiring prize, not stacked |

## Prize Pool — V1 Defaults

```jsonc
[
  { "tier_id": "thank_you",    "weight": 50, "type": "thank_you", "payload": {} },
  { "tier_id": "free_topping", "weight": 20, "type": "digital",
    "payload": { "kind": "free_modifier", "modifier_id": "<topping_modifier_id>" } },
  { "tier_id": "discount_3",   "weight": 15, "type": "digital",
    "payload": { "kind": "discount", "amount_cents": 300 } },
  { "tier_id": "sticker",      "weight": 10, "type": "physical",
    "payload": { "label": "Mandy's brand sticker" } },
  { "tier_id": "discount_5",   "weight":  4, "type": "digital",
    "payload": { "kind": "discount", "amount_cents": 500 } },
  { "tier_id": "free_drink",   "weight":  1, "type": "digital",
    "payload": { "kind": "free_drink", "max_cents": 1000 } }
]
```

`payload.modifier_id` and `payload.max_cents` for `free_drink` are set to the
real Square catalog values during migration authoring, after consulting the
production Square Dashboard.

## Data Model

Two new Supabase tables in the production project.

### `campaigns`

```sql
create table campaigns (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  prize_pool  jsonb not null,
  is_active   boolean not null default false,
  created_at  timestamptz not null default now(),
  check (ends_at > starts_at)
);

create unique index campaigns_one_active
  on campaigns (is_active) where is_active = true;
```

The partial unique index enforces "at most one active campaign" at the
database level — V1 invariant.

### `prize_rolls`

```sql
create table prize_rolls (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       uuid not null references campaigns(id),
  user_id           uuid not null references auth.users(id),
  square_order_id   text not null,
  tier_id           text not null,
  prize_type        text not null
    check (prize_type in ('thank_you', 'digital', 'physical')),
  prize_payload     jsonb not null default '{}'::jsonb,
  status            text not null default 'won_active'
    check (status in ('won_active', 'redeemed', 'claimed', 'expired', 'voided')),
  expires_at        timestamptz,
  redeemed_order_id text,
  claimed_at        timestamptz,
  voided_at         timestamptz,
  claim_code        text unique,
  rolled_at         timestamptz not null default now(),
  unique (square_order_id)
);

create index prize_rolls_active_digital
  on prize_rolls (user_id, expires_at)
  where prize_type = 'digital' and status = 'won_active';

create index prize_rolls_user_physical_cap
  on prize_rolls (user_id, campaign_id)
  where prize_type = 'physical' and status in ('won_active', 'claimed', 'expired');
```

`UNIQUE(square_order_id)` makes roll insertion idempotent against retries.
`claim_code` is a 6-character Crockford base32 string (alphabet
`0123456789ABCDEFGHJKMNPQRSTVWXYZ` — no `I`, `L`, `O`, `U`) generated at
INSERT time for `physical` rows; null for `thank_you` and `digital`. Collision
on the unique index is retried (regenerate up to 5 times before throwing).

## Architecture & Cross-Repo Responsibilities

| Repo | Touch Points |
|------|--------------|
| `mandys_bubble_tea` (web) | New migration for `campaigns` + `prize_rolls`; `/api/orders` POST adds source detection + roll + auto-apply; `/api/webhooks/square` adds void-on-refund branch; new `GET /api/campaigns/active`; new `GET /api/prizes/me` |
| `mandys_bubble_tea_app` | `lib/api.ts` adds `__source: "app"` body field on order POST; `app/order-confirmation/[orderId].tsx` consumes new `prize` field and renders `PrizeRevealModal`; `app/order-detail/[orderId].tsx` (my-orders detail) renders the "Used: …" line when `appliedPrize` is present; `app/(tabs)/account.tsx` adds "Active prizes" section that calls `GET /api/prizes/me` |
| `mandys_bubble_tea_admin` | New `/campaigns/[id]/winners` page: list of physical `won_active` rows with claim-code lookup + "Mark claimed" button; secondary tab shows roll counts and tier hit-distribution |
| `printer-client` | No changes |

## Flows

### Flow A — Order triggers roll

1. App POSTs to `/api/orders` with `__source: "app"` in body.
2. Existing handler builds Square order → payment → loyalty accrual.
3. After loyalty accrual, before response, handler calls
   `rollPrize({ userId, squareOrderId, source })`:
   - If `source !== "app"`, return `null`.
   - Look up active campaign (`is_active=true AND now() BETWEEN starts_at AND ends_at`).
     If none, return `null`.
   - Query existing physical-prize rolls for `(user_id, campaign_id)` with status
     `won_active | claimed | expired`. If found, mask physical tiers from the
     pool and renormalize remaining weights.
   - Run weighted-random selection (`crypto.randomInt`-seeded over a cumulative
     weight table).
   - INSERT into `prize_rolls` with `status='won_active'`,
     `expires_at = now() + interval '30 days'` for digital,
     `now() + interval '7 days'` for physical, `null` for thank-you. Generate
     `claim_code` only for physical. `UNIQUE(square_order_id)` makes the insert
     idempotent.
   - Return `{ tier_id, prize_type, label, claim_code? }`.
4. Response shape extends to `{ orderId, ..., prize: {...} | null }`.
5. App `order-confirmation` route reads `prize`, opens `PrizeRevealModal` once
   (guarded by `AsyncStorage` key `prize_seen_${roll_id}` to avoid re-firing on
   navigation back).

### Flow B — Digital prize auto-apply on next order

1. App POSTs to `/api/orders` with `__source: "app"`.
2. Before Square `createOrder`, handler queries:
   ```sql
   SELECT * FROM prize_rolls
   WHERE user_id = $1
     AND prize_type = 'digital'
     AND status = 'won_active'
     AND expires_at > now()
   ORDER BY expires_at ASC
   LIMIT 1
   ```
3. If a row is returned, the handler injects the prize into the Square order
   payload according to `prize_payload.kind`:
   - `discount` → `OrderLineItemDiscount` with `type: "FIXED_AMOUNT"`,
     `amount_money: amount_cents`, `scope: "ORDER"`.
   - `free_modifier` → append `modifier_id` to the first line item with
     `base_price_money.amount: 0`. Topping selection: V1 picks one
     pre-configured "default" topping ID stored in `payload.modifier_id`
     (e.g., Pearl). User-chosen topping at redemption time is V2 — see
     Open Questions.
   - `free_drink` → `OrderLineItemDiscount` `type: "FIXED_AMOUNT"`,
     `scope: "LINE_ITEM"`, `applied_money.amount` equal to the
     most-expensive line item's `base_price_money * quantity`, capped at
     `payload.max_cents`. Attached via `applicable_discounts` on that
     specific line item to ensure Square applies the discount to the
     intended drink, not the cheapest one.
4. After Square confirms the order with the discounted total, UPDATE
   `prize_rolls SET status='redeemed', redeemed_order_id=<new square order id>`.
5. Response includes `appliedPrize: { tier_id, label }` so the app receipt UI
   shows a "Used: Free topping" line.

If multiple active digital prizes exist, only the earliest-expiring one is
applied. Coupons do not stack on a single order.

### Flow C — Physical prize claim at counter

1. User opens app → Account tab → "Active prizes" section shows the physical
   prize card with the 6-character claim code and QR (encoding
   `mandybt-claim:<claim_code>`).
2. User shows the screen to staff.
3. Staff opens admin `/campaigns/[id]/winners`, types the 6-character code in
   the lookup box (or scans the QR — V2 nice-to-have, V1 ships keyboard input
   only).
4. Admin displays the matching row: customer first name, masked phone, prize
   label, expires_at. Staff confirms identity and clicks "Mark claimed".
5. Backend executes `UPDATE prize_rolls SET status='claimed', claimed_at=now()
   WHERE id=$1 AND status='won_active'`. The `WHERE` clause makes the action
   idempotent and prevents double-claim races between two concurrent staff
   sessions — the second click receives a 409 with "Already claimed".
6. App's "Active prizes" section refreshes (60s polling) and the card
   disappears.

### Flow D — Refund voids the prize

1. Square sends a `refund.updated` event with `data.object.refund.status =
   "COMPLETED"` to `/api/webhooks/square`. The handler subscribes to
   `refund.updated` (not `refund.created`, which only signals initiation —
   we want completion). Subscription must be added to the existing webhook
   configuration in the Square Developer Dashboard.
2. Handler reads `data.object.refund.order_id` and `data.object.refund.amount_money`.
   It compares the cumulative refund amount against the original order total
   (via `orders.get`); only when the order is **fully** refunded (cumulative
   refunds ≥ order total) does it trigger void logic. Partial refunds do not
   void the prize.
3. On full refund, handler queries `prize_rolls WHERE square_order_id =
   <refunded order id>`. If a row exists with `status NOT IN ('voided')`,
   UPDATE `status='voided', voided_at=now()`.
4. Voided rows are excluded from the physical-cap mask in Flow A (the user
   regains a chance to win a physical prize on a future order).
5. Rows where `redeemed_order_id` matches the refunded order are **not**
   reactivated — using a coupon and then refunding the order does not return
   the coupon to the user.

### Flow E — Physical-cap mask

The mask in Flow A step 3 reads `status IN ('won_active', 'claimed', 'expired')`.
This locks the physical tier even when the user fails to claim within 7 days
(prevents farming via deliberate non-claim). Only `voided` (caused by refund)
releases the lock.

A daily cron (or lazy check on next roll) flips `won_active` rows past their
`expires_at` to `expired`. V1 ships the lazy variant: any time a row is read
in a hot path, if `status='won_active' AND expires_at < now()`, the read
treats it as expired without writing — a nightly cron handles the actual
status flip for accurate analytics.

## App UX Components

### `PrizeRevealModal`

```
components/prize/PrizeRevealModal.tsx
  - Props: { prize: PrizeReveal | null, onDismiss: () => void }
  - Three variants by prize_type:
    * thank_you: grey background, bow emoji, "Better luck next sip!", "Got it"
    * digital:   #C43A10 background, confetti animation, prize label,
                 "Auto-applies on your next order", "Sweet!"
    * physical:  cream background, confetti, prize label, large 6-char code,
                 QR (react-native-qrcode-svg), "Show at the counter within 7
                 days", "Got it"
  - Confetti: react-native-reanimated 4 driving 30-50 absolute-positioned
    `<View>` particles with randomized rotation/translation/easing in a
    `useAnimatedStyle` chain. The project already uses reanimated 4.x in
    DoodleCanvas. No Skia dep needed; no third-party confetti library
    (react-native-confetti-cannon is unmaintained for RN 0.74+).
  - Trigger: order-confirmation route useEffect with a one-shot ref guard.
  - Dismiss: tap button, tap backdrop, swipe down. After dismissal, write
    AsyncStorage key `prize_seen_${roll_id}` to prevent re-firing on
    navigation re-entry.
```

### Account "Active prizes" section

```
app/(tabs)/account.tsx
  - Inserts between LoyaltyCard and the "How it works" box.
  - GET /api/prizes/me → array of { id, tier_id, prize_type, label,
    expires_at, claim_code? }, status='won_active' only.
  - Renders nothing if the array is empty (no "no prizes" placeholder).
  - Digital card: prize label · "Auto-applies next order" · "expires May 28"
  - Physical card: prize label · large code · QR thumbnail · "expires May 11"
  - 60-second auto-refresh aligned with the loyalty refresh cadence.
```

### Order receipt "Used" line

When a digital prize was applied to an order (Flow B), the
`order-confirmation` page and the my-orders detail view both display a
"✓ Used: <prize label>" line under the line-item totals to make consumption
visible.

## API Surface

### `POST /api/orders` (existing, modified)

Request body adds optional `__source: "app" | "web"` (web client always
sends `"web"` for symmetry; default if missing is `"web"` so older app
builds without the field default to non-eligible).

Response body adds:

```ts
{
  // existing fields...
  prize?: {
    rollId: string,
    tier_id: string,
    prize_type: 'thank_you' | 'digital' | 'physical',
    label: string,
    payload: object,           // shape depends on tier_id
    claim_code?: string,       // present only for physical
    expires_at?: string,       // ISO8601, null for thank_you
  } | null,
  appliedPrize?: {
    rollId: string,
    tier_id: string,
    label: string,
  } | null
}
```

### `GET /api/campaigns/active` (new)

Returns the currently active campaign metadata for app-side display
(banner on home screen showing "Order to win" — can be a follow-up,
not strictly V1-required).

### `GET /api/prizes/me` (new)

Returns active prizes for the authenticated user:

```ts
{
  prizes: Array<{
    id: string,
    tier_id: string,
    prize_type: 'digital' | 'physical',
    label: string,
    expires_at: string,
    claim_code?: string
  }>
}
```

`thank_you` rows are never returned (no actionable state).

### Admin claim endpoint (new)

`POST /api/admin/prizes/claim` (admin auth, fixed-creds + signed cookie per
the existing admin pattern):

```ts
// Request
{ claim_code: string }

// Response 200
{
  prize: { id, label, customer_first_name, customer_phone_masked,
           rolled_at, expires_at }
}

// Response 409 if already claimed/voided/expired
// Response 404 if not found
```

A second `POST /api/admin/prizes/<id>/mark-claimed` performs the actual
status flip after staff confirmation.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Roll INSERT fails (DB error or `UNIQUE(square_order_id)` collision) | Catch, log, continue order flow with `prize: null` in response. Roll failure must never break checkout. |
| Active digital prize lookup fails before order create | Catch, log, skip auto-apply. Order proceeds at full price. The prize remains `won_active` for retry on a later order. |
| Square `createOrder` fails after coupon was injected into payload | Roll back UPDATE to `redeemed`. Prize stays `won_active` until a successful order consumes it. |
| Guest checkout (no authenticated user) | `rollPrize` returns null. Guests are not eligible (no anchor for cap). |
| Refund webhook duplicate delivery | UPDATE includes `WHERE status != 'voided'` guard for idempotency. |
| Active campaign ends but user still has unredeemed digital coupons | Coupons remain valid until `expires_at`. Campaign window and coupon window are decoupled. |
| Concurrent staff "Mark claimed" race | DB-level `WHERE status='won_active'` guards the UPDATE. The second request receives 409 "Already claimed by another staff". |
| `claim_code` collision on INSERT | Regenerate up to 5 times, then surface a 500 (extreme — base32^6 = 1B addresses). |

## Testing Strategy

| Layer | Coverage | Tool |
|-------|----------|------|
| Web unit | Weighted-random distribution within ±1% over 100k samples; renormalization correctness when physical is masked; seedable RNG for deterministic tests | vitest with seeded `mulberry32`-style RNG injected via DI |
| Web unit | Auto-apply payload shaping: `discount`, `free_modifier`, `free_drink` each produce the correct Square order payload | vitest snapshot |
| Web unit | Refund webhook void path; redeemed-order rows do not reactivate on refund; idempotency on duplicate webhook | vitest |
| Web unit | `claim_code` generator excludes ambiguous chars; uniqueness retry logic | vitest |
| Web integration | `/api/orders` POST with `__source=app` during active campaign + non-locked user → returns `prize`. With `__source=web` → no `prize`. With guest session → no `prize`. | supertest with mocked Square + Supabase |
| Web integration | Active digital prize → next order's `totalMoney` reflects discount + status flips to `redeemed` + `redeemed_order_id` set | supertest |
| App unit | `PrizeRevealModal` renders three variants; AsyncStorage seen-key dedupe works; modal dismiss handlers fire | jest + React Native Testing Library |
| App unit | Account "Active prizes" section hides when empty; renders digital and physical cards correctly | jest + RNTL |
| Manual / E2E | Real order on TestFlight → confetti modal fires; Account section shows the prize; second order auto-applies the digital prize and shows "Used: …"; in-store mock claim flow on admin staging marks the row claimed; refund of trigger order voids the prize | TestFlight + admin staging |

## Migration & Deployment Sequence

Three repos must coordinate. Order matters but is fail-safe in either
direction.

1. **Web first**: merge `mandys_bubble_tea` PR, run the SQL migration through
   Supabase MCP `apply_migration` against production. The migration creates
   tables but no campaign row, so `is_active=true` returns no rows and the
   roll path returns `null` for every order. Web continues to function
   unchanged.
2. **Admin second**: merge `mandys_bubble_tea_admin` PR. The winners page
   shows zero rows until campaigns and rolls exist.
3. **App third**: archive a TestFlight build with the new
   `PrizeRevealModal` + Account section + `__source` header. Older app
   builds without the field continue to work — the web handler defaults
   missing `__source` to `"web"` and they roll nothing.
4. **Activate**: after all three are deployed and smoke-tested, INSERT the
   first campaign row with `is_active=true` and the `prize_pool` JSON.
   Rolls begin immediately on the next app order.

Rollback: `UPDATE campaigns SET is_active=false`. Prize_rolls history is
preserved; users with active digital coupons can still redeem until their
`expires_at` (campaign end and coupon expiry are decoupled).

## Branch Strategy

- `mandys_bubble_tea` (web): branch `feat/lottery-prize` from clean main.
- `mandys_bubble_tea_app`: branch `feat/lottery-prize` from clean main
  (current `feat/cup-label-app-doodle` is doodle agent's work and is
  11 commits behind main as of 2026-04-28; do not branch from it).
- `mandys_bubble_tea_admin`: branch `feat/lottery-prize-winners` from
  clean main.

Each branch ships an independent PR. Migration SQL lives in admin's
`migrations/` directory but is applied through the Supabase MCP (existing
project pattern).

Per `feedback_subagent_branch_pin`, any subagent spawned to do parallel
work must pin its branch as Step 0 (`git checkout feat/lottery-prize`)
before any other action — `cmux` panes share global git state and can be
yanked between branches by other agents.

## Open Questions Deferred to Implementation

- Exact Square modifier ID for the "free topping" prize (look up in Square
  Dashboard during migration authoring). V1 hard-codes one topping; user
  topping choice at redemption time is V2.
- Real prize labels (e.g., "Mandy's Sticker — Cherry Edition") — V1 uses
  generic labels, refined when the first real campaign is authored.
- Most-expensive-line-item resolution for `free_drink` when the order
  contains multiple drinks of equal price: V1 picks the first such line
  item by index. Acceptable since the discount amount is identical.
- Whether to send a one-time push notification "Your prize expires
  tomorrow" 1 day before `expires_at`. Not in V1 scope, parking-lot for V2.
- Whether the admin winners page should support QR scanning via webcam in
  addition to keyboard input. V1 ships keyboard-only.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Roll path adds latency to `/api/orders` POST | Roll happens after payment success, response timing is non-blocking on user; even +200ms is invisible behind the existing Square round-trip. Logged metric for p95 on the roll step. |
| User refunds an order purely to retry the lottery (farming) | Voided rolls release the physical cap but not consumed digital coupons; the time + friction of refunding makes farming uneconomical relative to the expected value of one extra roll. Monitor `voided` rate; if abuse appears, add cooldown or rate limit. |
| Physical prize inventory exhaustion | V1 ships only stickers (low cost, high stock). For V2 with higher-value physical prizes, add `prize_pool[].max_inventory` and decrement-on-roll with row-level lock. |
| Two staff sessions claim the same prize | DB-level `WHERE status='won_active'` guard returns 409 to the loser; admin UI shows the toast. |
| App build older than `__source` field deployed | Server defaults missing `__source` to `"web"`; old app users simply do not roll until they update. No errors surface to them. |
| Migration applied but campaign row never inserted | Behavior is identical to "no active campaign" — feature silently does nothing. Safe default. |

## Acceptance Criteria

The feature is V1-complete when, on a TestFlight build with an active
campaign in production:

1. Placing an order from the app produces a `prize` field in the response
   and renders the appropriate `PrizeRevealModal` variant.
2. Placing an order from web (`mandybubbletea.com`) does not produce a
   prize.
3. After winning a digital prize, placing a subsequent app order
   auto-applies the discount/modifier and the receipt shows the "Used"
   line.
4. After winning a physical prize, the Account "Active prizes" section
   shows the card with claim code; admin can look up the code and mark
   it claimed; the card disappears from Account on next refresh.
5. Refunding the order that triggered a prize voids it; the user can win
   a physical prize again on a later order.
6. After winning a physical prize without claiming, attempting another
   order during the same campaign window does not produce a physical
   prize (only digital or thank-you).
7. Roll latency contributes < 250ms to the `/api/orders` p95.
