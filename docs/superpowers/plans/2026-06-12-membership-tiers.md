# Membership Tiers (Silver/Gold/Diamond) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Derived membership tiers from Square loyalty lifetimePoints — Gold (≥30) / Diamond (≥80) get 5% off online orders, Diamond gets 10 free toppings per Brisbane calendar month, with flashy tier card UI on the web account page.

**Architecture:** Tier is pure derivation (no stored tier). The only new state is `tier_topping_usage` (Supabase, mirrors `welcome_discounts` consume pattern: orders route attaches discount + stamps metadata, payment route consumes after settle). Discounts are server-authoritative order-level FIXED_AMOUNT, sized from catalog prices only.

**Tech Stack:** Next.js App Router, TypeScript, Square SDK v44 (bigint cents), Supabase (service client + SECURITY DEFINER RPC), vitest, Tailwind v4 (tokens in `src/app/globals.css`).

**Spec:** `docs/superpowers/specs/2026-06-12-membership-tiers-design.md`

**Key existing facts (verified):**
- `src/app/api/orders/route.ts` — discounts built at lines 324–445 (`welcomeDiscounts`/`igFollowDiscounts`, uid `welcome-discount`/`ig-follow-discount`, FIXED_AMOUNT ORDER scope), metadata stamped at 566–585 (`welcomeDiscountDrinksCovered` pattern), `priceMaps` built at 183–186 (null on menu-fetch failure → discounts skipped).
- `src/app/api/payment/route.ts` — consume happens HERE after `paymentSettled` (lines 415–470): checks `order.discounts` uid + reads `order.metadata.*DrinksCovered`, calls consume RPC wrapper. `customerId` already in scope.
- `src/lib/loyalty.ts` `findLoyaltyAccountByPhone(phoneE164)` → `{accountId, balance, lifetimePoints} | null`, never creates.
- `AuthProvider` already exposes `loyalty.lifetimePoints` client-side → UI derives tier with the same pure lib; `/api/loyalty/account` unchanged.
- `pickPromoCups` (`src/lib/promo-cup-pick.ts`) allocates cheapest cups to rewards first; reward cup values = cheapest `loyaltyRewardCount` unit prices.
- Consume RPC wrapper pattern: `consumeWelcomeDiscount` in `src/lib/supabase.ts:233-258` (rpc call, fail-safe returns zeros, never throws).
- Theme tokens: `--color-brand: #8D5524`, `--color-peach: #FFB380`, `--color-cream: #FFF3DE` in `src/app/globals.css`. No tailwind.config (v4).
- Test layout: pure libs `src/lib/X.test.ts`; route contract tests `tests/api-contract/{auth,mutation}/*.test.ts` (see `tests/api-contract/mutation/api-post-orders-store-gate.test.ts` for the orders-route mocking pattern).
- Run: `npx vitest run <path>`; full: `npx vitest run`; types: `npx tsc --noEmit`.

---

### Task 1: Tier core — `src/lib/membership-tier.ts`

**Files:**
- Create: `src/lib/membership-tier.ts`
- Test: `src/lib/membership-tier.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/membership-tier.test.ts
import { describe, expect, it } from "vitest";
import {
  DIAMOND_MONTHLY_FREE_TOPPINGS,
  TIER_DISCOUNT_PERCENT,
  TIER_THRESHOLDS,
  brisbaneMonthKey,
  tierFor,
  tierProgress,
} from "@/lib/membership-tier";

describe("tierFor", () => {
  it("maps lifetime points to tiers at exact boundaries", () => {
    expect(tierFor(0)).toBe("silver");
    expect(tierFor(29)).toBe("silver");
    expect(tierFor(30)).toBe("gold");
    expect(tierFor(79)).toBe("gold");
    expect(tierFor(80)).toBe("diamond");
    expect(tierFor(500)).toBe("diamond");
  });

  it("treats negative/NaN as silver", () => {
    expect(tierFor(-5)).toBe("silver");
    expect(tierFor(Number.NaN)).toBe("silver");
  });
});

describe("tierProgress", () => {
  it("silver progresses toward gold", () => {
    expect(tierProgress(23)).toEqual({ tier: "silver", nextTier: "gold", starsToNext: 7 });
  });
  it("gold progresses toward diamond", () => {
    expect(tierProgress(30)).toEqual({ tier: "gold", nextTier: "diamond", starsToNext: 50 });
    expect(tierProgress(79)).toEqual({ tier: "gold", nextTier: "diamond", starsToNext: 1 });
  });
  it("diamond is terminal", () => {
    expect(tierProgress(80)).toEqual({ tier: "diamond", nextTier: null, starsToNext: null });
  });
});

describe("brisbaneMonthKey", () => {
  it("uses fixed UTC+10 (Brisbane, no DST)", () => {
    // 2026-06-30T15:00Z = 2026-07-01T01:00 Brisbane → next month
    expect(brisbaneMonthKey(new Date("2026-06-30T15:00:00Z"))).toBe("2026-07");
    // 2026-06-30T13:59Z = 2026-06-30T23:59 Brisbane → same month
    expect(brisbaneMonthKey(new Date("2026-06-30T13:59:00Z"))).toBe("2026-06");
  });

  it("constants", () => {
    expect(TIER_THRESHOLDS).toEqual({ gold: 30, diamond: 80 });
    expect(TIER_DISCOUNT_PERCENT).toBe(5);
    expect(DIAMOND_MONTHLY_FREE_TOPPINGS).toBe(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/membership-tier.test.ts`
Expected: FAIL — cannot resolve `@/lib/membership-tier`

- [ ] **Step 3: Implement**

```typescript
// src/lib/membership-tier.ts
/**
 * Membership tiers derived from Square loyalty lifetimePoints.
 * Tier is NEVER stored — always recomputed from lifetimePoints, so
 * existing members qualify automatically and there is no sync path.
 * Thresholds: Gold = 30 lifetime stars; Diamond = 80 (30 + 50 more,
 * per the business rule "金升钻的 50 星不含银升金的 30 星").
 */

export type MembershipTier = "silver" | "gold" | "diamond";

export const TIER_THRESHOLDS = { gold: 30, diamond: 80 } as const;
/** Gold + Diamond: percent off online orders (web + app). */
export const TIER_DISCOUNT_PERCENT = 5;
/** Diamond: free paid-topping units per Brisbane calendar month. */
export const DIAMOND_MONTHLY_FREE_TOPPINGS = 10;

export function tierFor(lifetimePoints: number): MembershipTier {
  const pts = Number.isFinite(lifetimePoints) ? lifetimePoints : 0;
  if (pts >= TIER_THRESHOLDS.diamond) return "diamond";
  if (pts >= TIER_THRESHOLDS.gold) return "gold";
  return "silver";
}

export function tierProgress(lifetimePoints: number): {
  tier: MembershipTier;
  nextTier: Exclude<MembershipTier, "silver"> | null;
  starsToNext: number | null;
} {
  const pts = Number.isFinite(lifetimePoints) ? Math.max(0, lifetimePoints) : 0;
  const tier = tierFor(pts);
  if (tier === "silver") {
    return { tier, nextTier: "gold", starsToNext: TIER_THRESHOLDS.gold - pts };
  }
  if (tier === "gold") {
    return { tier, nextTier: "diamond", starsToNext: TIER_THRESHOLDS.diamond - pts };
  }
  return { tier, nextTier: null, starsToNext: null };
}

/**
 * 'YYYY-MM' month key in Brisbane time. Brisbane has no DST, so a fixed
 * UTC+10 shift is exact (same approach as feedback_pyenv_no_tzdata memory).
 */
export function brisbaneMonthKey(date: Date = new Date()): string {
  return new Date(date.getTime() + 10 * 3600 * 1000).toISOString().slice(0, 7);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/membership-tier.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/membership-tier.ts src/lib/membership-tier.test.ts
git commit -m "feat(tier): membership tier core — thresholds, progress, Brisbane month key"
```

---

### Task 2: Free-topping math (pure) — `src/lib/tier-toppings.ts`

**Files:**
- Create: `src/lib/tier-toppings.ts`
- Test: `src/lib/tier-toppings.test.ts`

Pure, isomorphic (server sizes the real discount; checkout preview reuses it). A "cup record" is one physical cup: `{ unitPrice, toppingPrices }`, expanded by line quantity. Reward-covered cups (cheapest `excludeRewardCount` by unit price, matching `pickPromoCups` allocation) are excluded — their toppings are already free via the reward, never double-covered.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/tier-toppings.test.ts
import { describe, expect, it } from "vitest";
import {
  collectPaidToppingUnits,
  coverFreeToppings,
  type CupRecord,
} from "@/lib/tier-toppings";

const cup = (unitPrice: bigint, toppingPrices: bigint[]): CupRecord => ({
  unitPrice,
  toppingPrices,
});

describe("collectPaidToppingUnits", () => {
  it("collects paid toppings from all cups, most expensive first", () => {
    const cups = [cup(900n, [80n, 100n]), cup(750n, [60n])];
    expect(collectPaidToppingUnits(cups, 0)).toEqual([100n, 80n, 60n]);
  });

  it("drops zero-price toppings (included/free modifiers are not quota)", () => {
    const cups = [cup(900n, [0n, 80n, 0n])];
    expect(collectPaidToppingUnits(cups, 0)).toEqual([80n]);
  });

  it("excludes the cheapest N cups (loyalty-reward cups, already free)", () => {
    const cups = [cup(900n, [100n]), cup(500n, [60n]), cup(700n, [80n])];
    // 1 reward → cheapest cup (500n) excluded, its 60n topping not in pool
    expect(collectPaidToppingUnits(cups, 1)).toEqual([100n, 80n]);
  });

  it("excludeRewardCount >= cup count → empty pool", () => {
    expect(collectPaidToppingUnits([cup(900n, [100n])], 5)).toEqual([]);
  });
});

describe("coverFreeToppings", () => {
  it("covers up to remaining, most expensive first", () => {
    const r = coverFreeToppings([100n, 80n, 60n], 2);
    expect(r.coveredCount).toBe(2);
    expect(r.amount).toBe(180n);
  });

  it("covers all when remaining exceeds pool", () => {
    const r = coverFreeToppings([100n, 80n], 10);
    expect(r.coveredCount).toBe(2);
    expect(r.amount).toBe(180n);
  });

  it("zero remaining or empty pool → zero", () => {
    expect(coverFreeToppings([100n], 0)).toEqual({ coveredCount: 0, amount: 0n });
    expect(coverFreeToppings([], 5)).toEqual({ coveredCount: 0, amount: 0n });
    expect(coverFreeToppings([100n], -3)).toEqual({ coveredCount: 0, amount: 0n });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/tier-toppings.test.ts`
Expected: FAIL — cannot resolve module

- [ ] **Step 3: Implement**

```typescript
// src/lib/tier-toppings.ts
/**
 * Diamond-tier free toppings: pure allocation math (isomorphic — the
 * orders route sizes the real FIXED_AMOUNT discount with it, the
 * checkout page mirrors it for preview).
 *
 * Rules: only PAID toppings (price > 0) count against the monthly quota;
 * most-expensive-first (max value to customer); cups covered by loyalty
 * rewards are excluded (their toppings are already free).
 */

export type CupRecord = {
  /** Full cup price (variation + modifiers) — matches pickPromoCups units. */
  unitPrice: bigint;
  /** Catalog price of each topping/modifier on this cup. */
  toppingPrices: bigint[];
};

/**
 * Paid topping unit prices across cups, sorted most-expensive-first.
 * `excludeRewardCount` cheapest cups (by unitPrice, ties broken stably —
 * same ordering pickPromoCups uses) are excluded from the pool.
 */
export function collectPaidToppingUnits(
  cups: CupRecord[],
  excludeRewardCount: number,
): bigint[] {
  const exclude = Math.max(0, Math.floor(excludeRewardCount));
  const kept = [...cups]
    .sort((a, b) => (a.unitPrice < b.unitPrice ? -1 : a.unitPrice > b.unitPrice ? 1 : 0))
    .slice(Math.min(exclude, cups.length));
  return kept
    .flatMap((c) => c.toppingPrices.filter((p) => p > 0n))
    .sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
}

/** Cover up to `remaining` toppings from a most-expensive-first pool. */
export function coverFreeToppings(
  toppingUnitsDesc: bigint[],
  remaining: number,
): { coveredCount: number; amount: bigint } {
  const take = Math.min(Math.max(0, Math.floor(remaining)), toppingUnitsDesc.length);
  let amount = 0n;
  for (let i = 0; i < take; i++) amount += toppingUnitsDesc[i];
  return { coveredCount: take, amount };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/tier-toppings.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/tier-toppings.ts src/lib/tier-toppings.test.ts
git commit -m "feat(tier): free-topping allocation math (paid-only, expensive-first, reward-cup exclusion)"
```

---

### Task 3: Migration — `tier_topping_usage` + `consume_topping_allowance` RPC

**Files:**
- Create: `supabase/migrations/2026-06-12-tier-topping-usage.sql`

No code consumes it yet — file only. **Applied to prod (Supabase MCP `apply_migration`) in Task 10 BEFORE the code deploy** (additive: new table + new function, zero risk to running code — iron rule from [[feedback_prod_migration_constraint_swap_ahead_of_deploy]]).

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/2026-06-12-tier-topping-usage.sql
-- Diamond-tier monthly free-topping quota. One row per (customer, Brisbane
-- month). Monthly reset is implicit: a new month_key starts at used_count 0.
CREATE TABLE IF NOT EXISTS tier_topping_usage (
  customer_id   TEXT NOT NULL,
  month_key     TEXT NOT NULL CHECK (month_key ~ '^\d{4}-\d{2}$'),
  used_count    INT  NOT NULL DEFAULT 0 CHECK (used_count >= 0 AND used_count <= 10),
  last_order_id TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, month_key)
);

-- Service-role only (server routes). RLS on + no policies blocks anon/authed.
ALTER TABLE tier_topping_usage ENABLE ROW LEVEL SECURITY;

-- Atomic consume: row-locked, capped at 10/month. Returns what was actually
-- consumed (may be less than requested) + the new used_count.
CREATE OR REPLACE FUNCTION consume_topping_allowance(
  p_customer_id TEXT,
  p_month_key   TEXT,
  p_count       INT,
  p_order_id    TEXT
) RETURNS TABLE (consumed_count INT, used_count INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_used INT;
  v_take INT;
BEGIN
  INSERT INTO tier_topping_usage AS t (customer_id, month_key, used_count, last_order_id)
  VALUES (p_customer_id, p_month_key, 0, p_order_id)
  ON CONFLICT (customer_id, month_key) DO NOTHING;

  SELECT t.used_count INTO v_used
  FROM tier_topping_usage t
  WHERE t.customer_id = p_customer_id AND t.month_key = p_month_key
  FOR UPDATE;

  v_take := LEAST(GREATEST(COALESCE(p_count, 0), 0), 10 - v_used);

  IF v_take > 0 THEN
    UPDATE tier_topping_usage t
    SET used_count = t.used_count + v_take,
        last_order_id = p_order_id,
        updated_at = now()
    WHERE t.customer_id = p_customer_id AND t.month_key = p_month_key;
  END IF;

  RETURN QUERY SELECT v_take, v_used + GREATEST(v_take, 0);
END;
$$;

-- REVOKE FROM PUBLIC, not just anon/authenticated — default PUBLIC grant
-- otherwise leaks execute (see feedback_postgres_revoke_from_public_not_just_roles).
REVOKE ALL ON FUNCTION consume_topping_allowance(TEXT, TEXT, INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_topping_allowance(TEXT, TEXT, INT, TEXT) TO service_role;
```

- [ ] **Step 2: Sanity-check SQL locally**

Run: `npx tsc --noEmit` (no TS impact) and visually verify the file matches the welcome/IG migration conventions in `supabase/migrations/`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/2026-06-12-tier-topping-usage.sql
git commit -m "feat(tier): tier_topping_usage table + consume_topping_allowance RPC (service-role only)"
```

---

### Task 4: Supabase IO wrappers — allowance status + consume

**Files:**
- Create: `src/lib/tier-toppings-store.ts`
- Test: `src/lib/tier-toppings-store.test.ts`

Mirror the fail-safe style of `consumeWelcomeDiscount` (`src/lib/supabase.ts:233-258`): never throw; status failure returns `remaining: 0` (fail-safe = no discount, toppings charged normally — never the generous direction). Import the supabase service client the same way `src/lib/supabase.ts` does — check its `getSupabase()` helper and reuse the exact pattern (import from there if exported, else replicate).

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/tier-toppings-store.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ rpc: rpcMock, from: fromMock }),
}));

import {
  consumeToppingAllowance,
  getToppingAllowanceStatus,
} from "@/lib/tier-toppings-store";

describe("getToppingAllowanceStatus", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
  });

  it("returns full quota when no row exists", async () => {
    fromMock.mockReturnValue({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
        }),
      }),
    });
    const s = await getToppingAllowanceStatus("CUST1", "2026-06");
    expect(s).toEqual({ usedCount: 0, remaining: 10, monthKey: "2026-06" });
  });

  it("subtracts used_count", async () => {
    fromMock.mockReturnValue({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { used_count: 7 }, error: null }),
          }),
        }),
      }),
    });
    const s = await getToppingAllowanceStatus("CUST1", "2026-06");
    expect(s).toEqual({ usedCount: 7, remaining: 3, monthKey: "2026-06" });
  });

  it("fail-safe: query error → remaining 0", async () => {
    fromMock.mockReturnValue({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: new Error("boom") }),
          }),
        }),
      }),
    });
    const s = await getToppingAllowanceStatus("CUST1", "2026-06");
    expect(s.remaining).toBe(0);
  });
});

describe("consumeToppingAllowance", () => {
  beforeEach(() => rpcMock.mockReset());

  it("maps RPC row to camelCase", async () => {
    rpcMock.mockResolvedValue({
      data: [{ consumed_count: 3, used_count: 5 }],
      error: null,
    });
    const r = await consumeToppingAllowance("CUST1", "2026-06", 3, "ORDER1");
    expect(rpcMock).toHaveBeenCalledWith("consume_topping_allowance", {
      p_customer_id: "CUST1",
      p_month_key: "2026-06",
      p_count: 3,
      p_order_id: "ORDER1",
    });
    expect(r).toEqual({ consumedCount: 3, usedCount: 5 });
  });

  it("fail-safe: RPC error → consumed 0, never throws", async () => {
    rpcMock.mockResolvedValue({ data: null, error: new Error("down") });
    const r = await consumeToppingAllowance("CUST1", "2026-06", 3, "ORDER1");
    expect(r).toEqual({ consumedCount: 0, usedCount: 0 });
  });
});
```

(Adjust the mock to the project's actual supabase client construction — if `src/lib/supabase.ts` exports a shared `getSupabase()`, mock that module instead of `@supabase/supabase-js`; keep assertions identical.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/tier-toppings-store.test.ts`
Expected: FAIL — module missing

- [ ] **Step 3: Implement**

```typescript
// src/lib/tier-toppings-store.ts
import { DIAMOND_MONTHLY_FREE_TOPPINGS } from "@/lib/membership-tier";
// Reuse the same service-role client used by welcome-discount code.
// If src/lib/supabase.ts doesn't export its client getter, lift getSupabase()
// to an export there (one-line change) instead of duplicating construction.
import { getSupabase } from "@/lib/supabase";

export type ToppingAllowanceStatus = {
  usedCount: number;
  remaining: number;
  monthKey: string;
};

/** Fail-safe read: any error → remaining 0 (no free toppings, never over-grant). */
export async function getToppingAllowanceStatus(
  customerId: string,
  monthKey: string,
): Promise<ToppingAllowanceStatus> {
  try {
    const { data, error } = await getSupabase()
      .from("tier_topping_usage")
      .select("used_count")
      .eq("customer_id", customerId)
      .eq("month_key", monthKey)
      .maybeSingle();
    if (error) throw error;
    const used = Number(data?.used_count ?? 0);
    return {
      usedCount: used,
      remaining: Math.max(0, DIAMOND_MONTHLY_FREE_TOPPINGS - used),
      monthKey,
    };
  } catch (err) {
    console.error("[tier-toppings] status read failed:", err);
    return { usedCount: 0, remaining: 0, monthKey };
  }
}

/** Fail-safe consume: any error → consumedCount 0 (ledger under-counts, never over). */
export async function consumeToppingAllowance(
  customerId: string,
  monthKey: string,
  count: number,
  orderId: string,
): Promise<{ consumedCount: number; usedCount: number }> {
  try {
    const { data, error } = await getSupabase().rpc("consume_topping_allowance", {
      p_customer_id: customerId,
      p_month_key: monthKey,
      p_count: count,
      p_order_id: orderId,
    });
    if (error) throw error;
    const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
    if (!row) return { consumedCount: 0, usedCount: 0 };
    return {
      consumedCount: Number(row.consumed_count ?? 0),
      usedCount: Number(row.used_count ?? 0),
    };
  } catch (err) {
    console.error("[tier-toppings] consume failed:", err);
    return { consumedCount: 0, usedCount: 0 };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/tier-toppings-store.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/tier-toppings-store.ts src/lib/tier-toppings-store.test.ts src/lib/supabase.ts
git commit -m "feat(tier): topping allowance Supabase wrappers (fail-safe status + atomic consume)"
```

---

### Task 5: Orders route — tier 5% + diamond topping discount (server-authoritative)

**Files:**
- Modify: `src/app/api/orders/route.ts` (discount block ~324–445, metadata ~566–585)
- Test: `tests/api-contract/mutation/api-post-orders-tier-discount.test.ts`

**Behavior:**
1. After the welcome/IG block (after line ~440), for the signed-in user: `findLoyaltyAccountByPhone(recipientPhone)` inside try/catch → `tier = tierFor(account?.lifetimePoints ?? 0)`. Lookup failure or null account → silver (skip everything tier-related, order proceeds).
2. Requires `priceMaps` (same fail-safe as welcome: null → skip tier discounts entirely).
3. **Diamond toppings:** build `CupRecord[]` from `body.lines` × authoritative prices (per cup: `unitPrice = authoritativeUnitPrice(line, maps)`, `toppingPrices = line.modifiers.map(m => maps.modifierPriceById.get(m.id) ?? 0n)`, repeated `line.quantity` times). Pool = `collectPaidToppingUnits(cups, body.loyaltyRewardCount ?? 0)`. Read `getToppingAllowanceStatus(customerId, brisbaneMonthKey())` → `coverFreeToppings(pool, status.remaining)`. If `amount > 0n`: push discount `{uid: "tier-topping-allowance", name: \`Diamond Free Toppings (${coveredCount})\`, type: "FIXED_AMOUNT", amountMoney: {amount, currency}, scope: "ORDER"}` and stamp metadata `tierToppingsCovered: String(coveredCount)`.
4. **Tier 5% (gold + diamond):** `rewardCupsSum` = sum of cheapest `loyaltyRewardCount` authoritative unit prices (reuse `authoritativeUnitPrices` + sort asc + slice — must equal `pickPromoCups`' allocation). `base = drinksSubtotalCents − welcomeAmount − igAmount − rewardCupsSum − toppingAllowanceAmount`, floored at 0n. `amount = (base * 5n) / 100n`. If `> 0n`: push `{uid: "tier-discount", name: tier === "diamond" ? "Diamond Member 5% Off" : "Gold Member 5% Off", ...}`.
5. Both discounts append to `allDiscounts` before `orders.create`. Welcome/IG/reward/surcharge code paths byte-identical.

- [ ] **Step 1: Write failing contract tests** — follow the mocking pattern of `tests/api-contract/mutation/api-post-orders-store-gate.test.ts` (mock `@/lib/auth` getAuthedUser, `@/lib/catalog` getMenu, `@/lib/square` orders.create capture, `@/lib/supabase`, plus new mocks for `@/lib/loyalty` findLoyaltyAccountByPhone and `@/lib/tier-toppings-store`). Cases:

```typescript
// tests/api-contract/mutation/api-post-orders-tier-discount.test.ts — cases:
// 1. silver (lifetimePoints 29): orders.create called with NO uid "tier-discount" / "tier-topping-allowance"
// 2. gold (30): tier-discount present, amount = floor(5% of authoritative subtotal); name "Gold Member 5% Off"
// 3. diamond (80) + 2 paid toppings (80c,100c) + allowance remaining 10:
//    tier-topping-allowance amount 180n, metadata.tierToppingsCovered "2",
//    tier-discount amount = floor((subtotal - 180n) * 5n / 100n), name "Diamond Member 5% Off"
// 4. diamond + remaining 0 → no topping discount, 5% on full subtotal
// 5. diamond + welcome discount both: 5% base = subtotal − welcomeAmount − toppingAmount (assert exact bigint)
// 6. loyalty lookup throws → order succeeds, no tier discounts (fail-safe)
// 7. loyaltyRewardCount 1: reward cup (cheapest, incl its topping) excluded from
//    topping pool AND from 5% base
// Assert by inspecting the captured orders.create request body (discounts array, metadata).
```

Write all 7 as real tests with exact bigint expectations (cart fixture: 2 cups 900c/750c with toppings 100c+80c / 60c — precompute amounts in the test).

- [ ] **Step 2: Run to verify failures**

Run: `npx vitest run tests/api-contract/mutation/api-post-orders-tier-discount.test.ts`
Expected: FAIL (no tier discounts attached yet)

- [ ] **Step 3: Implement in `src/app/api/orders/route.ts`**

Imports to add:

```typescript
import { findLoyaltyAccountByPhone } from "@/lib/loyalty";
import { brisbaneMonthKey, tierFor, TIER_DISCOUNT_PERCENT } from "@/lib/membership-tier";
import { collectPaidToppingUnits, coverFreeToppings, type CupRecord } from "@/lib/tier-toppings";
import { getToppingAllowanceStatus } from "@/lib/tier-toppings-store";
import { authoritativeUnitPrice } from "@/lib/order-pricing"; // add to existing import
```

Insert after the welcome/IG `if (body.applyWelcomeDiscount || body.applyIgFollowDiscount) { ... }` block closes (~line 440), before `const allDiscounts`:

```typescript
    // ---- Membership tier perks (server-authoritative; client never sends tier).
    // Derived live from Square loyalty lifetimePoints. Any failure here must
    // never block the order — fail-safe to "no tier perks".
    let tierDiscounts:
      | Array<{
          uid: string;
          name: string;
          type: "FIXED_AMOUNT";
          amountMoney: { amount: bigint; currency: Currency };
          scope: "ORDER";
        }>
      | undefined;
    let tierToppingsCovered = 0;

    if (priceMaps) {
      try {
        const loyaltyAccount = await findLoyaltyAccountByPhone(recipientPhone);
        const tier = tierFor(loyaltyAccount?.lifetimePoints ?? 0);

        if (tier === "gold" || tier === "diamond") {
          const welcomeAmount = welcomeDiscounts?.[0]?.amountMoney.amount ?? 0n;
          const igAmount = igFollowDiscounts?.[0]?.amountMoney.amount ?? 0n;

          // Reward cups = cheapest N unit prices — must mirror pickPromoCups.
          const rewardCount = Math.max(0, Math.floor(body.loyaltyRewardCount ?? 0));
          const unitPricesAsc = authoritativeUnitPrices(body.lines, priceMaps).sort(
            (a, b) => (a < b ? -1 : a > b ? 1 : 0),
          );
          const rewardCupsSum = unitPricesAsc
            .slice(0, Math.min(rewardCount, unitPricesAsc.length))
            .reduce((s, p) => s + p, 0n);

          // Diamond: monthly free toppings (paid toppings only, most expensive
          // first, reward cups excluded — their toppings are already free).
          let toppingAmount = 0n;
          if (tier === "diamond") {
            const cups: CupRecord[] = [];
            for (const line of body.lines) {
              const unitPrice = authoritativeUnitPrice(line, priceMaps);
              const toppingPrices = line.modifiers.map(
                (m) => priceMaps!.modifierPriceById.get(m.id) ?? 0n,
              );
              const qty = Math.max(1, Math.floor(line.quantity));
              for (let i = 0; i < qty; i++) cups.push({ unitPrice, toppingPrices });
            }
            const pool = collectPaidToppingUnits(cups, rewardCount);
            if (pool.length > 0) {
              const status = await getToppingAllowanceStatus(
                customerId,
                brisbaneMonthKey(),
              );
              const cover = coverFreeToppings(pool, status.remaining);
              if (cover.amount > 0n) {
                toppingAmount = cover.amount;
                tierToppingsCovered = cover.coveredCount;
              }
            }
          }

          // 5% on what the customer actually pays for drinks — never the same
          // dollar twice (welcome/IG/reward/free-topping money excluded).
          let base =
            drinksSubtotalCents -
            welcomeAmount -
            igAmount -
            rewardCupsSum -
            toppingAmount;
          if (base < 0n) base = 0n;
          const tierAmount = (base * BigInt(TIER_DISCOUNT_PERCENT)) / 100n;

          const built: typeof tierDiscounts = [];
          if (toppingAmount > 0n) {
            built.push({
              uid: "tier-topping-allowance",
              name: `Diamond Free Toppings (${tierToppingsCovered})`,
              type: "FIXED_AMOUNT",
              amountMoney: { amount: toppingAmount, currency: BUSINESS.currency as Currency },
              scope: "ORDER",
            });
          }
          if (tierAmount > 0n) {
            built.push({
              uid: "tier-discount",
              name: tier === "diamond" ? "Diamond Member 5% Off" : "Gold Member 5% Off",
              type: "FIXED_AMOUNT",
              amountMoney: { amount: tierAmount, currency: BUSINESS.currency as Currency },
              scope: "ORDER",
            });
          }
          if (built.length > 0) tierDiscounts = built;
        }
      } catch (tierError) {
        console.error(
          "[orders] tier perks skipped:",
          tierError instanceof Error ? tierError.message : tierError,
        );
        tierDiscounts = undefined;
        tierToppingsCovered = 0;
      }
    }
```

Then change `allDiscounts` and metadata:

```typescript
    const allDiscounts = [
      ...(welcomeDiscounts ?? []),
      ...(igFollowDiscounts ?? []),
      ...(tierDiscounts ?? []),
    ];
```

```typescript
          ...(tierToppingsCovered > 0
            ? { tierToppingsCovered: String(tierToppingsCovered) }
            : {}),
```
(add inside the existing `metadata: { ... }` object alongside `igFollowDiscountDrinksCovered`).

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/api-contract/mutation/api-post-orders-tier-discount.test.ts`
Expected: PASS (7 tests). Also `npx vitest run tests/api-contract/mutation/` — no regression in existing orders tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/orders/route.ts tests/api-contract/mutation/api-post-orders-tier-discount.test.ts
git commit -m "feat(tier): server-authoritative gold/diamond 5% + diamond free-topping discount on orders"
```

---

### Task 6: Payment route — consume topping allowance after settle

**Files:**
- Modify: `src/app/api/payment/route.ts` (after the IG consume block, ~line 470)
- Test: extend `tests/api-contract/mutation/api-post-payment.test.ts` (or sibling new file `api-post-payment-tier-toppings.test.ts` following its mocks)

Mirror the welcome/IG consume shape exactly (route.ts:415–470): gate on `paymentSettled` + discount uid present + metadata count > 0.

- [ ] **Step 1: Write failing tests**

```typescript
// cases (new file tests/api-contract/mutation/api-post-payment-tier-toppings.test.ts):
// 1. settled payment + order has uid "tier-topping-allowance" + metadata.tierToppingsCovered "3"
//    → consumeToppingAllowance called with (customerId, brisbaneMonthKey(), 3, orderId)
// 2. payment NOT settled → consume NOT called
// 3. no tier-topping-allowance discount → consume NOT called
// 4. metadata missing/garbage ("abc") → consume NOT called
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/api-contract/mutation/api-post-payment-tier-toppings.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement** — add after the IG-follow consume block in `src/app/api/payment/route.ts`:

```typescript
    // Consume diamond free-topping quota only when payment settled — same
    // policy as welcome/IG: a failed charge must not burn the allowance.
    const hadTierToppingAllowance = (order.discounts ?? []).some(
      (d) => d.uid === "tier-topping-allowance",
    );
    if (paymentSettled && hadTierToppingAllowance) {
      const rawCovered = order.metadata?.tierToppingsCovered;
      const parsedCovered = rawCovered ? parseInt(rawCovered, 10) : 0;
      const coveredCount =
        Number.isFinite(parsedCovered) && parsedCovered > 0 ? parsedCovered : 0;
      if (coveredCount > 0) {
        await consumeToppingAllowance(
          customerId,
          brisbaneMonthKey(),
          coveredCount,
          body.orderId,
        );
      }
    }
```

Imports: `import { brisbaneMonthKey } from "@/lib/membership-tier";` and `import { consumeToppingAllowance } from "@/lib/tier-toppings-store";`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/api-contract/mutation/api-post-payment-tier-toppings.test.ts src/app/api/payment/route.test.ts`
Expected: PASS, zero regressions

- [ ] **Step 5: Commit**

```bash
git add src/app/api/payment/route.ts tests/api-contract/mutation/api-post-payment-tier-toppings.test.ts
git commit -m "feat(tier): consume diamond topping allowance after settled payment"
```

---

### Task 7: `GET /api/tier/toppings` — remaining quota for UI

**Files:**
- Create: `src/app/api/tier/toppings/route.ts`
- Test: `tests/api-contract/auth/api-get-tier-toppings.test.ts`

- [ ] **Step 1: Failing tests** — follow `tests/api-contract/auth/api-get-welcome-discount-unauth.test.ts` pattern: (1) unauth → `{ok:true, remaining:0, limit:10}` with no Supabase call; (2) authed → returns `getToppingAllowanceStatus` remaining for current `brisbaneMonthKey()`.

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/api-contract/auth/api-get-tier-toppings.test.ts` → FAIL

- [ ] **Step 3: Implement**

```typescript
// src/app/api/tier/toppings/route.ts
import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth";
import {
  DIAMOND_MONTHLY_FREE_TOPPINGS,
  brisbaneMonthKey,
} from "@/lib/membership-tier";
import { getToppingAllowanceStatus } from "@/lib/tier-toppings-store";

export const dynamic = "force-dynamic";

// Remaining diamond free-topping quota for the signed-in member this
// Brisbane month. Display-only — the orders route re-derives everything.
export async function GET(request: Request) {
  const user = await getAuthedUser(request);
  const customerId = user?.profile?.square_customer_id;
  if (!customerId) {
    return NextResponse.json({
      ok: true,
      remaining: 0,
      limit: DIAMOND_MONTHLY_FREE_TOPPINGS,
    });
  }
  const status = await getToppingAllowanceStatus(customerId, brisbaneMonthKey());
  return NextResponse.json({
    ok: true,
    remaining: status.remaining,
    limit: DIAMOND_MONTHLY_FREE_TOPPINGS,
    monthKey: status.monthKey,
  });
}
```

- [ ] **Step 4: Run tests** — PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/tier/toppings/route.ts tests/api-contract/auth/api-get-tier-toppings.test.ts
git commit -m "feat(tier): GET /api/tier/toppings remaining-quota endpoint"
```

---

### Task 8: Checkout preview — tier discount + free-topping lines

**Files:**
- Modify: `src/app/checkout/page.tsx` (promo math memo ~185–245, totals ~442–455, summary render — locate the welcome discount display row and add siblings)

**Behavior (mirror server bigint math exactly):**
- `tier = tierFor(loyalty?.lifetimePoints ?? 0)` from `useAuth()` (AuthProvider already exposes `loyalty.lifetimePoints`).
- Diamond: on mount fetch `/api/tier/toppings` → `toppingsRemaining`. Build `CupRecord[]` from cart lines (client store prices — display only), `collectPaidToppingUnits(cups, rewardCount)`, `coverFreeToppings(pool, toppingsRemaining)` → `tierToppingAmount`, `tierToppingsCoveredCount`.
- Gold/diamond: `tierBase = subtotal − rewardDiscount − welcomeDiscountAmount − igFollowDiscountAmount − tierToppingAmount` (floor 0n); `tierDiscountAmount = tierBase * 5n / 100n`.
- Add both to `totalDiscount` so `afterDiscount`/total/Apple Pay sheet match the server-created order total.
- Render rows next to the existing welcome row: `Gold Member −5%` / `Diamond Member −5%` with `−$X.XX`, and for diamond with coverage: `Free toppings ×N (M left this month)` with `−$X.XX`.
- Signed-in silver / signed-out: zero change.

- [ ] **Step 1: Failing test** — `src/lib/` math is already covered; add a focused component-free test for the new memo helper. Extract the checkout tier math into `src/lib/tier-checkout-preview.ts`:

```typescript
// src/lib/tier-checkout-preview.ts
import { TIER_DISCOUNT_PERCENT, type MembershipTier } from "@/lib/membership-tier";
import {
  collectPaidToppingUnits,
  coverFreeToppings,
  type CupRecord,
} from "@/lib/tier-toppings";

export function tierCheckoutPreview(args: {
  tier: MembershipTier;
  cups: CupRecord[];
  rewardCount: number;
  toppingsRemaining: number;
  subtotal: bigint;
  rewardDiscount: bigint;
  welcomeDiscount: bigint;
  igFollowDiscount: bigint;
}): { tierDiscountCents: bigint; toppingCoveredCents: bigint; toppingCoveredCount: number } {
  if (args.tier === "silver") {
    return { tierDiscountCents: 0n, toppingCoveredCents: 0n, toppingCoveredCount: 0 };
  }
  let toppingCoveredCents = 0n;
  let toppingCoveredCount = 0;
  if (args.tier === "diamond") {
    const pool = collectPaidToppingUnits(args.cups, args.rewardCount);
    const cover = coverFreeToppings(pool, args.toppingsRemaining);
    toppingCoveredCents = cover.amount;
    toppingCoveredCount = cover.coveredCount;
  }
  let base =
    args.subtotal -
    args.rewardDiscount -
    args.welcomeDiscount -
    args.igFollowDiscount -
    toppingCoveredCents;
  if (base < 0n) base = 0n;
  return {
    tierDiscountCents: (base * BigInt(TIER_DISCOUNT_PERCENT)) / 100n,
    toppingCoveredCents,
    toppingCoveredCount,
  };
}
```

Test `src/lib/tier-checkout-preview.test.ts`: silver→all zero; gold 5% of (subtotal − welcome); diamond toppings covered then 5% of remainder; base floor at 0n.

- [ ] **Step 2: Run failing → implement helper → pass → wire into `checkout/page.tsx`** (memo depends on `[cartLines, rewardCount, toppingsRemaining, tier, subtotal, rewardDiscount, welcomeDiscountAmount, igFollowDiscountAmount]`), update `totalDiscount`, add the two summary rows (match existing row markup/classes around the welcome row).

- [ ] **Step 3: Verify** — `npx vitest run src/lib/tier-checkout-preview.test.ts` PASS; `npx tsc --noEmit` clean; manual: cmux dev server checkout renders unchanged for signed-out user.

- [ ] **Step 4: Commit**

```bash
git add src/lib/tier-checkout-preview.ts src/lib/tier-checkout-preview.test.ts src/app/checkout/page.tsx
git commit -m "feat(tier): checkout preview shows member 5% + diamond free-topping lines"
```

---

### Task 9: Tier card UI — 三档酷炫卡面 + tilt + 升档 celebration

**Files:**
- Modify: `src/components/account/LoyaltyCard.tsx` (tier visual variants)
- Create: `src/components/account/useCardTilt.ts` (pointer 3D tilt hook)
- Create: `src/components/account/TierUpCelebration.tsx`
- Modify: `src/app/account/page.tsx` (pass `lifetimePoints`, fetch toppings remaining for diamond, mount celebration)
- Modify: `src/app/globals.css` (keyframes)

**Design (no new deps, pure CSS + light JS):**

1. `LoyaltyCard` gains props `lifetimePoints: number` and `freeToppingsRemaining?: number | null`. Internally `const { tier, nextTier, starsToNext } = tierProgress(lifetimePoints)`.
2. Tier visual config:

```typescript
const TIER_VISUALS = {
  silver: {
    label: "SILVER",
    cardStyle: {
      background:
        "linear-gradient(135deg,#aeb6c2 0%,#7d8794 35%,#c6ccd6 60%,#8b94a3 100%)",
    },
    badgeClass: "bg-white/25 text-white",
    shimmer: false,
    sparkles: false,
  },
  gold: {
    label: "GOLD",
    cardStyle: {
      background:
        "linear-gradient(135deg,#b98a2c 0%,#8a5f14 30%,#e9c25c 55%,#a4762066 80%,#9c6f1d 100%)",
    },
    badgeClass: "bg-[#fff3d6]/30 text-[#fff3d6]",
    shimmer: true,
    sparkles: false,
  },
  diamond: {
    label: "DIAMOND",
    cardStyle: {
      background:
        "linear-gradient(135deg,#11131a 0%,#1d2030 40%,#11131a 100%)",
    },
    badgeClass: "bg-white/15 text-[#cfe7ff]",
    shimmer: true,
    sparkles: true,
  },
} as const;
```

   Diamond additionally overlays an iridescent holo layer (absolutely-positioned, `mix-blend-mode: overlay`):
   `background: linear-gradient(115deg, #ff9ee633 10%, #8ec5ff44 35%, #9dffce33 60%, #ffd98f33 85%); animation: tier-holo-pan 7s ease-in-out infinite alternate;`
3. Shimmer sweep (gold + diamond): absolutely-positioned diagonal strip `linear-gradient(105deg, transparent 40%, rgba(255,255,255,.35) 50%, transparent 60%)`, `animation: tier-shimmer 3.2s ease-in-out infinite`. Keyframes in `globals.css`:

```css
@keyframes tier-shimmer {
  0% { transform: translateX(-120%); }
  55%, 100% { transform: translateX(160%); }
}
@keyframes tier-holo-pan {
  from { background-position: 0% 50%; }
  to { background-position: 100% 50%; }
}
@keyframes tier-sparkle {
  0%, 100% { opacity: 0; transform: scale(0.4); }
  50% { opacity: 1; transform: scale(1); }
}
@keyframes tier-confetti-fall {
  0% { transform: translateY(-12vh) rotate(0deg); opacity: 1; }
  100% { transform: translateY(110vh) rotate(720deg); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .tier-shimmer, .tier-holo, .tier-sparkle, .tier-confetti { animation: none !important; }
}
```

4. Sparkles (diamond): 6 absolutely-positioned `✦` spans (fixed `left/top` percentages + per-span `animation-delay`), class `tier-sparkle`, `animation: tier-sparkle 2.8s ease-in-out infinite`.
5. Card content: keep existing balance/StarCupsRow/redeem affordances byte-equivalent in logic; replace the static `Member` pill with `{TIER_VISUALS[tier].label}` badge; under StarCupsRow add tier progress line: `starsToNext != null ? \`${starsToNext} ⭐ to ${nextTier === "gold" ? "Gold" : "Diamond"}\` : "Top tier member"`. Diamond + `freeToppingsRemaining != null`: extra line `\`${freeToppingsRemaining} free toppings left this month\``.
6. `useCardTilt`: returns `{ref, onPointerMove, onPointerLeave, style}`; rotateX/rotateY max ±8deg from pointer offset, `transform: perspective(900px) rotateX(...) rotateY(...)`, transition 120ms, disabled when `matchMedia("(prefers-reduced-motion: reduce)").matches` or no fine pointer.
7. `TierUpCelebration`: client component; props `tier`. On mount: read `localStorage.mandy_last_tier`; rank silver<gold<diamond; if stored exists and new rank is higher → render fixed overlay of ~40 confetti `<span class="tier-confetti">` (random-ish deterministic positions from index, brand palette `#FFB380/#e9c25c/#8ec5ff/#fff`), `animation: tier-confetti-fall 2.4s ease-in forwards` + center toast "Welcome to {Gold|Diamond}! 🎉"; auto-unmount after 2.8s. Always write the current tier back. SSR-safe (all in `useEffect`).
8. `src/app/account/page.tsx`: pass `lifetimePoints={lifetime}` (already computed), render `<TierUpCelebration tier={tierFor(lifetime)} />`; when `tierFor(lifetime) === "diamond"` fetch `/api/tier/toppings` (simple `useEffect` + state, or extend the page's existing data hooks) → pass `freeToppingsRemaining`.

- [ ] **Step 1: Failing tests** — component logic tests (vitest, no DOM render needed for hooks): `src/components/account/LoyaltyCard.test.tsx` if a component-test setup exists; otherwise test the pure pieces: `tierProgress` already covered; add `src/lib/tier-up.test.ts` for a small pure `shouldCelebrate(prev: string|null, next: MembershipTier): boolean` helper (export from `TierUpCelebration.tsx` or a tiny `src/lib/tier-up.ts`): null→false, silver→gold true, gold→gold false, diamond→gold false.

- [ ] **Step 2: Implement all four files per the design above.** Keep `LoyaltyCard` a server-compatible component except the tilt (extract interactive wrapper as a small `"use client"` component if `LoyaltyCard` is currently server-rendered — check its usage; account page is client already).

- [ ] **Step 3: Verify**

Run: `npx vitest run` (full) + `npx tsc --noEmit` — clean.
cmux: dev server → `/account` signed-out (card hidden/unchanged), then with dev session if available; `cmux browser errors list` + `console list` clean; screenshot card at silver state minimum (`/tmp/cmux-tier-card.png`) and Read it to eyeball gradient/badge/progress.

- [ ] **Step 4: Commit**

```bash
git add src/components/account/ src/app/account/page.tsx src/app/globals.css src/lib/tier-up.ts src/lib/tier-up.test.ts
git commit -m "feat(tier): silver/gold/diamond card faces — shimmer, holo, sparkles, 3D tilt, tier-up confetti"
```

---

### Task 10: Ship — migration → PR → preview → prod

- [ ] **Step 1: Full quality gate**

Run: `npx vitest run` → expect ≥ existing pass count + ~35 new, 0 new failures (2 known pre-existing widget-data failures acceptable if present in this repo — verify against clean main first). `npx tsc --noEmit` → 0 errors. `npm run build` (or `npx next build`) → green.

- [ ] **Step 2: Apply migration to prod Supabase FIRST** (additive — safe before code): Supabase MCP `apply_migration` with the Task 3 SQL, name `tier_topping_usage`. Verify: `select * from tier_topping_usage limit 1` (0 rows), `select has_function_privilege('anon','consume_topping_allowance(text,text,int,text)','execute')` → false.

- [ ] **Step 3: Branch + PR** — `git checkout -b feat/membership-tiers && git push -u origin feat/membership-tiers`, `gh pr create`. Wait for Vercel preview build green; cmux the preview URL: menu/checkout signed-out unaffected, no console errors.

- [ ] **Step 4: ff-merge → prod** — `git checkout main && git merge --ff-only feat/membership-tiers && git push`. Wait prod build green.

- [ ] **Step 5: Prod smoke** — `curl -s https://mandybubbletea.com/api/tier/toppings` → `{"ok":true,"remaining":0,"limit":10}` (unauth); `/account` HTTP 200; `/api/loyalty/account` unauth shape unchanged.

- [ ] **Step 6: Commit nothing further; update agentic-loop checklist evidence.**

---

## Self-review notes
- Spec coverage: thresholds/derivation (T1), 5% server (T5), toppings quota+RPC (T3/T4/T5/T6), monthly reset implicit (T3), checkout preview (T8), 酷炫卡面+celebration+reduced-motion (T9), fail-safe matrix (T4/T5 case 6), deploy order (T10). ✓
- Consume timing corrected from spec ("at order creation") to match the codebase's real welcome/IG pattern: **discount attached at order create, quota consumed at settled payment** — spec's intent ("same timing as welcome consumption") preserved; spec updated in T10 if desired (not blocking).
- Type consistency: `CupRecord`, `coverFreeToppings` return `{coveredCount, amount}`, store wrappers return camelCase — consistent across T2/T4/T5/T8. ✓
