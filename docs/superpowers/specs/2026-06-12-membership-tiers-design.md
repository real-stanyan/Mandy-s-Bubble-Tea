# Membership Tiers (Silver / Gold / Diamond) — Design

**Date:** 2026-06-12
**Status:** Approved by Stan (chat)
**Scope:** Web (this phase). App card UI / Wallet pass colors / POS in-store discount = next phase.

## Business Rules

| Tier | Threshold (Square `lifetimePoints`) | Perks |
|------|--------------------------------------|-------|
| Silver | < 30 | none (base tier, every member) |
| Gold | ≥ 30 | 5% off all online orders |
| Diamond | ≥ 80 (30 + 50 more) | 5% off all online orders + 10 free toppings per calendar month |

- Tier is **derived, not stored**: computed from Square loyalty `lifetimePoints` at read time. Existing members qualify immediately on launch day. Lifetime points are never decremented by reward redemption (only by refund reversal — rare; tier may drop accordingly, accepted).
- "金卡升钻石卡累计 50 星（不算银卡升金卡的星）" → Diamond = lifetime 80 total.
- 5% applies to **online orders only** (web + app, both hit `/api/orders`). No POS/in-store automation (Square has no per-customer always-on percentage discount).
- Free toppings: **auto-applied at checkout**, calendar-month quota (Australia/Brisbane), resets implicitly by month key — no cron.

## Architecture (Approach A: pure derivation + minimal state)

Rejected alternatives: (B) stored tier with high-water mark — extra table + sync path, drift risk, not needed this phase; (C) Square-native — no such capability.

### 1. Tier core — new `src/lib/membership-tier.ts` (pure functions)
- `TIER_THRESHOLDS = { gold: 30, diamond: 80 }`, `TIER_DISCOUNT_PERCENT = 5`, `DIAMOND_MONTHLY_FREE_TOPPINGS = 10`
- `tierFor(lifetimePoints: number): "silver" | "gold" | "diamond"`
- `tierProgress(lifetimePoints)` → `{ tier, next: "gold"|"diamond"|null, starsToNext: number|null }`
- `brisbaneMonthKey(date): string` → `"YYYY-MM"` using fixed UTC+10 (Brisbane, no DST)
- Boundary tests: 29→silver, 30→gold, 79→gold, 80→diamond.

### 2. `/api/loyalty/account` (GET + POST)
Append to existing response: `tier`, `starsToNext`, `nextTier`. For diamond users the account page also needs `freeToppingsRemaining` — fetched via a small new `GET /api/tier/toppings` (signed-in; reads `tier_topping_usage` for current month key) to avoid coupling the loyalty route to Supabase.

### 3. Supabase state — new table + RPC (mirrors `welcome_discounts` pattern)
```sql
CREATE TABLE tier_topping_usage (
  customer_id TEXT NOT NULL,
  month_key   TEXT NOT NULL,          -- 'YYYY-MM' Brisbane
  used_count  INT  NOT NULL DEFAULT 0 CHECK (used_count >= 0 AND used_count <= 10),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  last_order_id TEXT,
  PRIMARY KEY (customer_id, month_key)
);
```
RPC `consume_topping_allowance(p_customer_id TEXT, p_month_key TEXT, p_count INT, p_order_id TEXT) RETURNS INT` — atomic upsert + increment capped at 10, returns the number actually consumed (may be less than requested). SECURITY DEFINER, `REVOKE FROM PUBLIC` + `GRANT EXECUTE TO service_role` (per [[feedback_postgres_revoke_from_public_not_just_roles]]). RLS enabled, no anon policies.

**Deploy order (iron rule):** migration applied to prod BEFORE code deploy (additive — safe).

### 4. `/api/orders` — server-authoritative discounts
For signed-in users, server looks up loyalty by `square_customer_id` → `lifetimePoints` → tier. **Client is never trusted for tier.**

Computation order (all from authoritative catalog prices, `lib/order-pricing.ts`):
1. Existing: welcome 30% / IG 10% cup picking, loyalty reward cups.
2. **Diamond topping allowance**: collect this order's paid topping modifier units (priceCents > 0, expanded by quantity), sort most-expensive-first, cover up to `10 − used_count` units. Discount amount = sum of covered toppings' catalog prices → order-level FIXED_AMOUNT discount uid `tier-topping-allowance`, covered count stamped into order metadata `tierToppingsCovered`. Quota is consumed via RPC in `/api/payment` **after the payment settles** (exactly the existing welcome/IG consume pattern — a failed charge never burns the allowance). RPC/lookup failure → toppings charged normally (fail-safe).
3. **Tier 5%** (gold + diamond): base = authoritative drinks subtotal − welcome amount − IG amount − loyalty-reward cup values − topping allowance amount. Discount = 5% of base, rounded down (bigint cents) → order-level FIXED_AMOUNT discount uid `tier-discount`. Never double-discounts the same dollar.
- Loyalty lookup failure → skip tier discount entirely, order proceeds (matches existing discount fail-safe policy).
- App note: app checkout hits the same route and pays by orderId, so app users get the 5% charged correctly this phase; app preview line items catch up next phase. Approved by Stan.

### 5. Web UI (the 酷炫 part)
- **LoyaltyCard tier variants** (replaces single brick-red card):
  - Silver: brushed silver-grey metallic gradient.
  - Gold: gold gradient + animated shimmer sweep (CSS keyframes).
  - Diamond: dark base + iridescent holographic gradient + subtle sparkle particles.
  - Pointer-tracked 3D perspective tilt + metallic highlight (light JS, no new deps).
  - Tier badge (SILVER/GOLD/DIAMOND), progress to next tier ("7 ⭐ to Gold"), diamond shows free-toppings-left this month.
  - All animations respect `prefers-reduced-motion`.
- **Tier-up celebration**: account page compares tier vs localStorage `mandy_last_tier`; on upgrade plays one-time confetti/glow.
- **Checkout**: tier discount line ("Gold member −5%: −$X.XX") + diamond free-topping line ("N free toppings applied · M left this month"), mirroring server math for preview.

### 6. Error handling summary
| Failure | Behavior |
|---|---|
| Loyalty lookup fails in orders route | skip tier discount + allowance, order proceeds |
| consume RPC fails | toppings charged normally, 5% still applies (base unchanged by allowance=0) |
| Supabase read fails on account page | card renders without toppings count |
| Signed-out checkout | no tier anything (unchanged) |

### 7. Testing
- TDD throughout. Unit: tier boundaries, month key (UTC+10), 5% base math, most-expensive-first coverage, cap/partial consume, dedupe×quantity expansion.
- Route tests: orders four states (signed-out / silver / gold / diamond), discount uids + amounts, fail-safe paths.
- Full vitest + tsc, cmux real-render check (errors/console/snapshot/screenshot), PR → preview green → ff-merge → prod green + smoke.
