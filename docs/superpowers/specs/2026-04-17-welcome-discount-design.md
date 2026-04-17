# Welcome Discount — New User 30% Off

Date: 2026-04-17
Status: Design approved, pending implementation plan

## Goal

Grant every newly-registered customer a one-time 30% off discount on any single future order (subtotal-based, never expires, auto-applied at checkout). Existing customers registered before this feature ships do NOT receive it.

## Rules

- **Amount**: 30% off order subtotal (Square `ad-hoc` `ORDER`-scope percentage discount)
- **Eligibility**: granted at account creation for customers created after feature launch
- **Lifetime**: permanent until consumed — no expiry
- **Redemption**: auto-applied at checkout, no code entry
- **Stacking**: allowed to coexist with loyalty reward redemption (line-level free drink); Square handles the math
- **Existing users**: receive nothing (no retroactive grant)
- **Per customer**: one-time use only

## Data model

Supabase table:

```sql
create table welcome_discounts (
  customer_id text primary key,           -- Square customer id
  state text not null default 'unused',   -- 'unused' | 'used'
  percentage int not null default 30,
  granted_at timestamptz not null default now(),
  used_at timestamptz,
  order_id text                            -- Square order id that consumed it
);
```

RPC for atomic consume:

```sql
create function consume_welcome_discount(p_customer_id text, p_order_id text)
returns table (consumed bool, percentage int) as $$
  update welcome_discounts
  set state = 'used', used_at = now(), order_id = p_order_id
  where customer_id = p_customer_id and state = 'unused'
  returning true as consumed, percentage;
$$ language sql;
```

Empty result set = already used or no row for this customer.

## Server changes

### Grant — `/api/customer` POST

In the `created: true` branch (after a new Square customer is created), insert a row:

```sql
insert into welcome_discounts (customer_id) values ($1)
on conflict (customer_id) do nothing;
```

Wrap in try/catch — failure is logged but does NOT block signup.

### Status lookup — `GET /api/welcome-discount/status?customerId=...`

Returns `{ ok: true, available: boolean, percentage: number }`. Pure Supabase read. Used by Home banner, Account card, and Checkout. Client-side cached in `api-cache.ts` with 60s TTL.

### Apply discount — `/api/orders` POST

New optional body field: `applyWelcomeDiscount?: boolean`.

When `true`:
1. Verify server-side: `SELECT state FROM welcome_discounts WHERE customer_id = ? AND state = 'unused'`
2. If valid, include on the Square order:
   ```ts
   discounts: [{
     uid: "welcome-discount",
     name: "Welcome 30% Off",
     percentage: "30",
     scope: "ORDER",
   }]
   ```
3. Square returns totals already reflecting the discount. Client does not re-compute.
4. If Supabase says the row is `used`/missing, silently ignore — do not attach discount, do not error. Prevents client spoofing.

### Consume — `/api/payment` success path

On payment success, call `rpc('consume_welcome_discount', { p_customer_id, p_order_id })`.

- Hit: mark used, include in response so client can invalidate cache.
- Miss: log warn, payment continues normally. Accepts rare concurrent-double-use as known tradeoff.

## Client UX (three surfaces)

All three only render when `status.available === true`.

### 1. Home banner

Top of `/` for signed-in users. Brand-color card:

> **Your Welcome Gift**
> 30% off your first order — auto-applied at checkout
> [Order Now →]

Dismissable for the current session only (`sessionStorage` flag). Reappears on next login / fresh tab until consumed.

### 2. Account page card

Below `MemberQrCard`. White card, `30% OFF` large text, explanation, `View Menu` CTA. Disappears automatically when status flips to `used`.

### 3. Checkout Order Summary line

Extra line above total, styled like loyalty redeem:

> Welcome 30% Off    −$X.XX

Frontend renders the line using `subtotal × 0.30` for display. Final total uses Square's returned `totalMoney` after order create, not a client recomputation. Payment button amount updates accordingly.

### Promotions page (read-only addition)

`/account/promotions` gains a small section showing either:
- `Active — 30% off, auto-applied at checkout`
- `Used on Order #OLxxx on <date>`

Info-only, no action buttons.

## Cache invalidation

On payment success response where `welcomeDiscountConsumed === true`:
1. Invalidate `welcome-discount:status:<customerId>` cache in `api-cache.ts`
2. Optimistically set `available: false` in any in-memory stores (Account dashboard state)
3. Next home / account render fetches fresh and gets `available: false`

## Edge cases & risks

| Case | Behavior |
|------|----------|
| Supabase down during grant | Log error, signup still succeeds (user signs up, gets no welcome discount — recoverable later if we add a retry job, but out of scope now) |
| Supabase down during consume | Log error, payment succeeds. User may appear to still have discount until cache refreshes or next `/status` call |
| Client sends `applyWelcomeDiscount` without actually having one | Server verify fails silently, order goes through at full price |
| Two tabs place orders concurrently | Both orders get 30% off from Square; one `consume_welcome_discount` RPC hits, other misses (logged). Acceptable |
| Refund on a consumed discount | Out of scope. Discount stays `used`. Future: Square webhook to flip `state` back to `unused` |
| Loyalty redeem + welcome discount on same order | Both apply. Loyalty reward is line-level, welcome is order-level. Square handles stacking |
| Account deleted / phone changed | Treated as new customer; new Square customer id → new welcome discount. Acceptable; same behavior as any first-time signup |

## Non-goals (YAGNI)

- Manual promo code entry field
- Discount expiry / time windows
- Admin UI to change the 30% rate
- Email / push reminders ("you haven't used your discount yet")
- Refund-triggered restore
- Per-item or category restrictions

## Testing

Manual:
- New signup (fresh phone) → status=available → banner + account card + checkout line all show → pay → Square order has discount entry → status=used → all three surfaces disappear → next order no discount
- Existing customer (no `welcome_discounts` row) → status=available=false → no surfaces show
- Multi-login/out without ordering → discount persists
- Client spoofing: POST `/api/orders` with `applyWelcomeDiscount: true` but no Supabase row → order created without discount
- Signup with Supabase temporarily unreachable → signup succeeds, log entry recorded, no discount granted

## Future (not now)

- Retry job to backfill welcome discounts for signups that failed Supabase insert
- Admin control of percentage / expiry windows
- Refund webhook to restore consumed discounts
- Recurring promotions (seasonal / anniversary rewards)
