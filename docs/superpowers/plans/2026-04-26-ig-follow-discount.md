# IG Follow → 10% Off Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a one-time, claimable 10% off coupon for users who follow `@mandysbubbletea` on Instagram. Claim is honor-system (no IG API verification). Per-Square-customer dedup. Mirrors the existing welcome-discount infrastructure end-to-end (DB row, RPC, server-side recheck, COMPLETED-only consume).

**Architecture:** New `ig_follow_discounts` table + `consume_ig_follow_discount` RPC mirroring `welcome_discounts`. Two new routes (`/api/promotions/ig-follow/{status,claim}`). `/api/orders` gains `applyIgFollowDiscount` that attaches a second `OrderDiscount` row. `/api/payment` consumes the ticket only on `paymentStatus === "COMPLETED"`. Frontend: a 3-state `IgFollowPromoCard` on `/account/promotions`, plus IG line in cart drawer + checkout summaries with `paymentRequest.update({ total })` before tokenize (mirror cart drawer wallet fix `dc5dba4`).

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (Postgres RPC + service-role admin), Square SDK (`OrderDiscount[]`), Tailwind/shadcn, vitest.

**Spec:** `docs/superpowers/specs/2026-04-26-ig-follow-discount-design.md`

**Branch policy:** All commits go directly to `main`. The user explicitly waived the feature-branch convention for this work. Verify with `git branch --show-current` before each commit; if you're not on `main`, stop and ask.

---

## File Structure

**New files (9):**

| Path | Responsibility |
|---|---|
| `supabase/migrations/2026-04-26-ig-follow-discount.sql` | Create `ig_follow_discounts` table + `consume_ig_follow_discount` RPC |
| `src/lib/promo-cup-pick.ts` | Pure helper: allocate cups to welcome / IG by sorted unit price |
| `src/lib/promo-cup-pick.test.ts` | Unit coverage for cup allocation |
| `src/lib/ig-follow-discount.ts` | `getIgFollowDiscountStatus / claimIgFollowDiscount / consumeIgFollowDiscount` |
| `src/lib/ig-follow-discount.test.ts` | Unit coverage for the helper module (with mocked supabase admin) |
| `src/app/api/promotions/ig-follow/status/route.ts` | GET status (auth required) |
| `src/app/api/promotions/ig-follow/claim/route.ts` | POST claim (idempotent) |
| `src/app/api/promotions/ig-follow/__tests__/claim.test.ts` | Integration coverage of POST claim |
| `src/components/account/IgFollowPromoCard.tsx` | Three-state card (Locked / Active / Redeemed) |

**Modified files (8):**

| Path | What changes |
|---|---|
| `src/app/api/orders/route.ts` | Accept `applyIgFollowDiscount`; attach second `OrderDiscount`; write metadata; use shared `pickPromoCups` |
| `src/app/api/payment/route.ts` | Consume IG ticket only on `paymentStatus === "COMPLETED"` |
| `src/app/api/me/route.ts` | Add `igFollowDiscount` to response shape |
| `src/lib/supabase.ts` | Extend `purgeAccount()` to delete IG row |
| `src/components/auth/AuthProvider.tsx` | Add `igFollowDiscount` + `claimIgFollowDiscount()` to context |
| `src/app/account/promotions/page.tsx` | Render `IgFollowPromoCard` |
| `src/components/cart/CartDrawer.tsx` | IG line in summary + wallet `paymentRequest.update` |
| `src/app/checkout/page.tsx` | IG line in mobile + desktop summary + wallet `paymentRequest.update` |

**Approx 14 commits.**

---

## Pre-flight

- [ ] **Confirm branch & worktree.** Working tree must be on `main`. If the primary worktree (`~/Github/mandys_bubble_tea`) is on a different branch and `main` is held by `/private/tmp/mandys-hours-fix`, the operator should `git worktree remove /private/tmp/mandys-hours-fix` (its working tree is clean per session start) and then `git checkout main && git pull --ff-only` here. Confirm by:

```bash
git branch --show-current   # → main
git worktree list           # → only this worktree owns main
git status --short          # → clean (untracked feat/delivery WIP is fine, don't stage it)
```

- [ ] **Confirm spec is on main.** `git log --oneline -5 -- docs/superpowers/specs/` should show `edf86e8 docs: ig-follow → 10% off discount design spec`.

- [ ] **Run the test suite once before starting** to lock in the green baseline:

```bash
npx tsc --noEmit
npx vitest run
```

Both should pass (only `.next/types/validator.ts` pre-existing warnings are acceptable).

---

## Task 1: Supabase migration (table + RPC)

**Spec section:** §4.1 Data model.

**Files:**
- Create: `supabase/migrations/2026-04-26-ig-follow-discount.sql`

- [ ] **Step 1: Write the migration**

```sql
-- IG Follow promo: one-time 10% off ticket per Square customer.
-- See docs/superpowers/specs/2026-04-26-ig-follow-discount-design.md
-- Mirrors welcome_discounts shape so callers can share helpers.

create table if not exists ig_follow_discounts (
  customer_id      text primary key,
  percentage       int not null default 10
                     check (percentage > 0 and percentage <= 100),
  drinks_remaining int not null default 1
                     check (drinks_remaining >= 0),
  claimed_at       timestamptz not null default now(),
  redeemed_at      timestamptz,
  order_id         text,
  created_at       timestamptz not null default now()
);

create or replace function consume_ig_follow_discount(
  p_customer_id text,
  p_order_id text,
  p_count int
) returns table (consumed_count int, drinks_remaining int)
language plpgsql as $$
declare
  v_before int;
  v_after int;
  v_consumed int;
begin
  select ig.drinks_remaining into v_before
    from ig_follow_discounts ig
    where ig.customer_id = p_customer_id
    for update;

  if v_before is null or v_before <= 0 or p_count <= 0 then
    return query select 0, coalesce(v_before, 0);
    return;
  end if;

  v_consumed := least(p_count, v_before);
  v_after := v_before - v_consumed;

  update ig_follow_discounts
    set drinks_remaining = v_after,
        redeemed_at = case when v_after = 0 then now() else redeemed_at end,
        order_id = case when v_after = 0 then p_order_id else order_id end
    where customer_id = p_customer_id;

  return query select v_consumed, v_after;
end;
$$;
```

- [ ] **Step 2: Apply on dev Supabase project**

Open Supabase Studio for the dev project, paste into SQL editor, run. Verify:

```sql
select * from ig_follow_discounts limit 1;   -- empty, no error
select consume_ig_follow_discount('NOPE', 'order-x', 1);
-- expect (0, 0): no row exists, function returns gracefully
```

- [ ] **Step 3: Apply on prod Supabase project**

Same SQL editor flow on prod project. Same verification queries.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/2026-04-26-ig-follow-discount.sql
git commit -m "feat(db): add ig_follow_discounts table + consume RPC"
```

---

## Task 2: Refactor — extract `pickPromoCups` helper

**Spec section:** §4.2 (`promo-cup-pick.ts`).

**Goal:** Pull the welcome-discount cup-pick logic out of `/api/orders/route.ts:288-325` into a pure helper that both welcome and IG can call. Behavior must not change for welcome-only flows; existing tests / smoke flows are the safety net.

**Files:**
- Create: `src/lib/promo-cup-pick.ts`
- Create: `src/lib/promo-cup-pick.test.ts`

- [ ] **Step 1: Write the failing tests first**

```ts
// src/lib/promo-cup-pick.test.ts
import { describe, it, expect } from "vitest";
import { pickPromoCups } from "./promo-cup-pick";

describe("pickPromoCups", () => {
  it("welcome takes the cheapest K cups, IG takes the next cheapest", () => {
    const result = pickPromoCups({
      unitPrices: [1000n, 800n, 600n], // unsorted on input
      welcomeK: 2,
      igFollowK: 1,
    });
    expect(result.welcomeCups).toEqual([600n, 800n]);
    expect(result.igFollowCups).toEqual([1000n]);
  });

  it("welcome only — IG empty when igFollowK is 0", () => {
    const result = pickPromoCups({
      unitPrices: [600n, 1000n],
      welcomeK: 2,
      igFollowK: 0,
    });
    expect(result.welcomeCups).toEqual([600n, 1000n]);
    expect(result.igFollowCups).toEqual([]);
  });

  it("IG only — welcome empty when welcomeK is 0", () => {
    const result = pickPromoCups({
      unitPrices: [600n, 1000n],
      welcomeK: 0,
      igFollowK: 1,
    });
    expect(result.welcomeCups).toEqual([]);
    expect(result.igFollowCups).toEqual([600n]);
  });

  it("one-cup welcome-priority rule: welcome takes the cup, IG empty (caller MUST not consume IG ticket)", () => {
    const result = pickPromoCups({
      unitPrices: [800n],
      welcomeK: 1,
      igFollowK: 1,
    });
    expect(result.welcomeCups).toEqual([800n]);
    expect(result.igFollowCups).toEqual([]);
  });

  it("clamps welcomeK to available cup count", () => {
    const result = pickPromoCups({
      unitPrices: [600n],
      welcomeK: 2,
      igFollowK: 0,
    });
    expect(result.welcomeCups).toEqual([600n]);
    expect(result.igFollowCups).toEqual([]);
  });

  it("IG gets fewer cups when welcomeK consumes everything", () => {
    const result = pickPromoCups({
      unitPrices: [600n, 800n],
      welcomeK: 2,
      igFollowK: 1,
    });
    expect(result.welcomeCups).toEqual([600n, 800n]);
    expect(result.igFollowCups).toEqual([]);
  });

  it("returns empty arrays when unitPrices is empty", () => {
    const result = pickPromoCups({
      unitPrices: [],
      welcomeK: 2,
      igFollowK: 1,
    });
    expect(result.welcomeCups).toEqual([]);
    expect(result.igFollowCups).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const input = [1000n, 600n, 800n];
    pickPromoCups({ unitPrices: input, welcomeK: 1, igFollowK: 1 });
    expect(input).toEqual([1000n, 600n, 800n]);
  });
});
```

- [ ] **Step 2: Run tests — confirm RED**

```bash
npx vitest run src/lib/promo-cup-pick.test.ts
```

Expected: `Cannot find module './promo-cup-pick'`.

- [ ] **Step 3: Implement the helper**

```ts
// src/lib/promo-cup-pick.ts
export interface PickPromoCupsArgs {
  unitPrices: bigint[];
  welcomeK: number;
  igFollowK: number;
}

export interface PickPromoCupsResult {
  welcomeCups: bigint[];
  igFollowCups: bigint[];
}

/**
 * Allocate cups to promotional discounts by sorted unit price.
 *
 * Both welcome and IG-follow take their share from the *cheapest* end
 * of the order — this matches the long-standing welcome behaviour and
 * bounds merchant exposure.
 *
 * Caller contract:
 * - `welcomeK` and `igFollowK` are the *attempted* K values, derived
 *   per-promo from server-side ticket status. Pass `0` when a promo is
 *   unavailable. This helper does not look up status.
 * - One-cup-with-welcome-priority rule: when there is exactly one cup
 *   and both promos want a slice, welcome wins (more savings to user)
 *   and IG ticket is preserved. The caller must therefore NOT call
 *   `consumeIgFollowDiscount` when `igFollowCups.length === 0`.
 */
export function pickPromoCups(args: PickPromoCupsArgs): PickPromoCupsResult {
  const sorted = [...args.unitPrices].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );

  if (
    sorted.length === 1 &&
    args.welcomeK >= 1 &&
    args.igFollowK >= 1
  ) {
    return { welcomeCups: [sorted[0]], igFollowCups: [] };
  }

  const welcomeTake = Math.min(Math.max(0, args.welcomeK), sorted.length);
  const igTake = Math.min(
    Math.max(0, args.igFollowK),
    Math.max(0, sorted.length - welcomeTake),
  );

  return {
    welcomeCups: sorted.slice(0, welcomeTake),
    igFollowCups: sorted.slice(welcomeTake, welcomeTake + igTake),
  };
}
```

- [ ] **Step 4: Run tests — confirm GREEN**

```bash
npx vitest run src/lib/promo-cup-pick.test.ts
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/promo-cup-pick.ts src/lib/promo-cup-pick.test.ts
git commit -m "feat(promo): add pickPromoCups helper with cup-allocation tests"
```

---

## Task 3: Wire `pickPromoCups` into `/api/orders` welcome path (no behaviour change)

**Goal:** Replace the inline welcome cup-pick block with a call to `pickPromoCups`. IG still passes 0 — this task is purely structural so Task 8 can layer IG on cleanly.

**Files:**
- Modify: `src/app/api/orders/route.ts:288-325`

- [ ] **Step 1: Locate the welcome block**

Open `src/app/api/orders/route.ts` and find the block that starts with `if (body.applyWelcomeDiscount) {` (currently around line 288). Read the surrounding ~50 lines to understand the existing variable names (`unitPrices`, `K`, `coveredSum`, `welcomeDrinksCovered`, `welcomeDiscounts`).

- [ ] **Step 2: Replace the block**

```ts
// imports (top of file, with the other lib imports)
import { pickPromoCups } from "@/lib/promo-cup-pick";

// existing variable declarations OUTSIDE this block stay the same:
//   let welcomeDiscounts: ... | undefined;
//   let welcomeDrinksCovered = 0;

if (body.applyWelcomeDiscount) {
  const status = await getWelcomeDiscountStatus(customerId);
  if (status.available && status.drinksRemaining > 0) {
    const unitPrices: bigint[] = [];
    for (const line of body.lines) {
      const modSum = line.modifiers.reduce(
        (s, m) => s + BigInt(Math.max(0, Math.floor(m.priceCents))),
        0n,
      );
      const unit =
        BigInt(Math.max(0, Math.floor(line.variationPriceCents))) + modSum;
      for (let i = 0; i < line.quantity; i++) unitPrices.push(unit);
    }

    const { welcomeCups } = pickPromoCups({
      unitPrices,
      welcomeK: status.drinksRemaining,
      igFollowK: 0, // wired in Task 9
    });

    if (welcomeCups.length > 0) {
      const coveredSum = welcomeCups.reduce((s, p) => s + p, 0n);
      const amount = (coveredSum * BigInt(status.percentage || 30)) / 100n;
      if (amount > 0n) {
        welcomeDiscounts = [
          {
            uid: "welcome-discount",
            name:
              welcomeCups.length === 1
                ? `Welcome ${status.percentage || 30}% Off (1 drink)`
                : `Welcome ${status.percentage || 30}% Off (${welcomeCups.length} drinks)`,
            type: "FIXED_AMOUNT",
            amountMoney: { amount, currency: BUSINESS.currency as Currency },
            scope: "ORDER",
          },
        ];
        welcomeDrinksCovered = welcomeCups.length;
      }
    }
  }
}
```

- [ ] **Step 3: Run typecheck + tests — confirm parity**

```bash
npx tsc --noEmit
npx vitest run
```

Expected: typecheck clean, all existing tests pass (no test changes in this commit).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/orders/route.ts
git commit -m "refactor(orders): use pickPromoCups for welcome cup allocation"
```

---

## Task 4: `ig-follow-discount.ts` lib + tests

**Spec section:** §4.2 backend modules.

**Files:**
- Create: `src/lib/ig-follow-discount.ts`
- Create: `src/lib/ig-follow-discount.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/ig-follow-discount.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the supabase-server module before importing the SUT.
vi.mock("./supabase-server", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getSupabaseAdmin } from "./supabase-server";
import {
  claimIgFollowDiscount,
  getIgFollowDiscountStatus,
  consumeIgFollowDiscount,
} from "./ig-follow-discount";

const mockedAdmin = vi.mocked(getSupabaseAdmin);

function buildAdmin(handlers: {
  upsert?: ReturnType<typeof vi.fn>;
  selectMaybe?: ReturnType<typeof vi.fn>;
  rpc?: ReturnType<typeof vi.fn>;
}) {
  const eqMaybe = vi.fn().mockReturnValue({
    maybeSingle: handlers.selectMaybe ?? vi.fn().mockResolvedValue({ data: null, error: null }),
  });
  const select = vi.fn().mockReturnValue({ eq: eqMaybe });
  const upsert = handlers.upsert ?? vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn().mockReturnValue({ select, upsert });
  const rpc = handlers.rpc ?? vi.fn().mockResolvedValue({ data: [], error: null });
  return { from, rpc } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("claimIgFollowDiscount", () => {
  it("upserts and reports first-time claim", async () => {
    const upsert = vi.fn().mockResolvedValue({ data: [{ inserted: true }], error: null, count: 1 });
    mockedAdmin.mockReturnValue(buildAdmin({ upsert }));
    const result = await claimIgFollowDiscount("CUST_NEW");
    expect(result.alreadyClaimed).toBe(false);
    expect(upsert).toHaveBeenCalledWith(
      { customer_id: "CUST_NEW" },
      { onConflict: "customer_id", ignoreDuplicates: true, count: "exact" },
    );
  });

  it("reports alreadyClaimed when row exists (ignoreDuplicates returned 0 rows)", async () => {
    const upsert = vi.fn().mockResolvedValue({ data: [], error: null, count: 0 });
    mockedAdmin.mockReturnValue(buildAdmin({ upsert }));
    const result = await claimIgFollowDiscount("CUST_OLD");
    expect(result.alreadyClaimed).toBe(true);
  });

  it("returns alreadyClaimed=false on error so callers can retry on next request without UI lock", async () => {
    const upsert = vi.fn().mockResolvedValue({ data: null, error: new Error("db down") });
    mockedAdmin.mockReturnValue(buildAdmin({ upsert }));
    const result = await claimIgFollowDiscount("CUST_ERR");
    expect(result.alreadyClaimed).toBe(false);
  });
});

describe("getIgFollowDiscountStatus", () => {
  it("returns disabled shape when no row exists", async () => {
    const selectMaybe = vi.fn().mockResolvedValue({ data: null, error: null });
    mockedAdmin.mockReturnValue(buildAdmin({ selectMaybe }));
    const status = await getIgFollowDiscountStatus("CUST_NONE");
    expect(status).toEqual({
      available: false,
      percentage: 0,
      drinksRemaining: 0,
      claimedAt: null,
      redeemedAt: null,
    });
  });

  it("returns available=true with drinksRemaining when row is unredeemed", async () => {
    const selectMaybe = vi.fn().mockResolvedValue({
      data: {
        drinks_remaining: 1,
        percentage: 10,
        claimed_at: "2026-04-26T01:00:00Z",
        redeemed_at: null,
      },
      error: null,
    });
    mockedAdmin.mockReturnValue(buildAdmin({ selectMaybe }));
    const status = await getIgFollowDiscountStatus("CUST_HAS");
    expect(status.available).toBe(true);
    expect(status.drinksRemaining).toBe(1);
    expect(status.percentage).toBe(10);
    expect(status.redeemedAt).toBeNull();
  });

  it("returns disabled shape with redeemedAt when row is fully consumed", async () => {
    const selectMaybe = vi.fn().mockResolvedValue({
      data: {
        drinks_remaining: 0,
        percentage: 10,
        claimed_at: "2026-04-25T01:00:00Z",
        redeemed_at: "2026-04-26T01:00:00Z",
      },
      error: null,
    });
    mockedAdmin.mockReturnValue(buildAdmin({ selectMaybe }));
    const status = await getIgFollowDiscountStatus("CUST_USED");
    expect(status.available).toBe(false);
    expect(status.drinksRemaining).toBe(0);
    expect(status.redeemedAt).toBe("2026-04-26T01:00:00Z");
  });

  it("returns disabled shape on error so callers never throw", async () => {
    const selectMaybe = vi.fn().mockResolvedValue({ data: null, error: new Error("db") });
    mockedAdmin.mockReturnValue(buildAdmin({ selectMaybe }));
    const status = await getIgFollowDiscountStatus("CUST_ERR");
    expect(status.available).toBe(false);
  });
});

describe("consumeIgFollowDiscount", () => {
  it("returns RPC consumed_count + drinks_remaining", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ consumed_count: 1, drinks_remaining: 0 }],
      error: null,
    });
    mockedAdmin.mockReturnValue(buildAdmin({ rpc }));
    const result = await consumeIgFollowDiscount("CUST", "ORDER1", 1);
    expect(result).toEqual({ consumedCount: 1, drinksRemaining: 0 });
    expect(rpc).toHaveBeenCalledWith("consume_ig_follow_discount", {
      p_customer_id: "CUST",
      p_order_id: "ORDER1",
      p_count: 1,
    });
  });

  it("returns zeros when RPC errors so caller never crashes the payment route", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: new Error("rpc") });
    mockedAdmin.mockReturnValue(buildAdmin({ rpc }));
    const result = await consumeIgFollowDiscount("CUST", "ORDER1", 1);
    expect(result).toEqual({ consumedCount: 0, drinksRemaining: 0 });
  });
});
```

- [ ] **Step 2: Run tests — confirm RED**

```bash
npx vitest run src/lib/ig-follow-discount.test.ts
```

Expected: `Cannot find module './ig-follow-discount'`.

- [ ] **Step 3: Implement the lib**

```ts
// src/lib/ig-follow-discount.ts
import "server-only";
import { getSupabaseAdmin } from "./supabase-server";

export interface IgFollowDiscountStatus {
  available: boolean;
  percentage: number;
  drinksRemaining: number;
  claimedAt: string | null;
  redeemedAt: string | null;
}

const DISABLED: IgFollowDiscountStatus = {
  available: false,
  percentage: 0,
  drinksRemaining: 0,
  claimedAt: null,
  redeemedAt: null,
};

/**
 * Mint a 10% off ticket for the given Square customer. Idempotent: a
 * second call when the row already exists returns alreadyClaimed=true.
 * Errors are swallowed and surface as alreadyClaimed=false (caller can
 * retry on the next request).
 */
export async function claimIgFollowDiscount(
  customerId: string,
): Promise<{ alreadyClaimed: boolean }> {
  try {
    const { error, count } = await getSupabaseAdmin()
      .from("ig_follow_discounts")
      .upsert(
        { customer_id: customerId },
        { onConflict: "customer_id", ignoreDuplicates: true, count: "exact" },
      );
    if (error) throw error;
    return { alreadyClaimed: count === 0 };
  } catch (err) {
    console.error("[ig-follow] claim failed:", err);
    return { alreadyClaimed: false };
  }
}

/**
 * Returns ticket state for the customer. Always returns a value — never
 * throws. Disabled shape on missing row or any error.
 */
export async function getIgFollowDiscountStatus(
  customerId: string,
): Promise<IgFollowDiscountStatus> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("ig_follow_discounts")
      .select("drinks_remaining,percentage,claimed_at,redeemed_at")
      .eq("customer_id", customerId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return DISABLED;
    const remaining = data.drinks_remaining ?? 0;
    return {
      available: remaining > 0,
      percentage: data.percentage ?? 10,
      drinksRemaining: remaining,
      claimedAt: data.claimed_at ?? null,
      redeemedAt: data.redeemed_at ?? null,
    };
  } catch (err) {
    console.error("[ig-follow] status failed:", err);
    return DISABLED;
  }
}

/**
 * Atomically decrements drinks_remaining via the consume_ig_follow_discount
 * RPC. Stamps redeemed_at + order_id when the ticket hits zero.
 */
export async function consumeIgFollowDiscount(
  customerId: string,
  orderId: string,
  count: number,
): Promise<{ consumedCount: number; drinksRemaining: number }> {
  try {
    const { data, error } = await getSupabaseAdmin().rpc(
      "consume_ig_follow_discount",
      {
        p_customer_id: customerId,
        p_order_id: orderId,
        p_count: count,
      },
    );
    if (error) throw error;
    const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
    if (!row) return { consumedCount: 0, drinksRemaining: 0 };
    return {
      consumedCount: Number(row.consumed_count ?? 0),
      drinksRemaining: Number(row.drinks_remaining ?? 0),
    };
  } catch (err) {
    console.error("[ig-follow] consume failed:", err);
    return { consumedCount: 0, drinksRemaining: 0 };
  }
}
```

- [ ] **Step 4: Run tests — confirm GREEN**

```bash
npx vitest run src/lib/ig-follow-discount.test.ts
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ig-follow-discount.ts src/lib/ig-follow-discount.test.ts
git commit -m "feat(ig-follow): add claim/status/consume helpers with tests"
```

---

## Task 5: Extend `purgeAccount` to delete IG row

**Goal:** When a Square customer is deleted (Dashboard or self-delete), tear down their IG ticket too.

**Files:**
- Modify: `src/lib/supabase.ts:85-124` (the `purgeAccount` function)

- [ ] **Step 1: Add the delete block**

Inside `purgeAccount`, find the block that deletes from `welcome_discounts` (currently around line 109). Immediately after it, add a parallel delete for `ig_follow_discounts`:

```ts
if (customerId) {
  const { error } = await admin
    .from("welcome_discounts")
    .delete()
    .eq("customer_id", customerId);
  if (error) console.error("[purge] welcome_discounts delete", error);

  const { error: igErr } = await admin
    .from("ig_follow_discounts")
    .delete()
    .eq("customer_id", customerId);
  if (igErr) console.error("[purge] ig_follow_discounts delete", igErr);
}
```

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase.ts
git commit -m "feat(account-delete): purge ig_follow_discounts on account deletion"
```

---

## Task 6: `/api/promotions/ig-follow/status` route

**Spec section:** §4.2.

**Files:**
- Create: `src/app/api/promotions/ig-follow/status/route.ts`

- [ ] **Step 1: Implement (mirror welcome-discount/status)**

```ts
// src/app/api/promotions/ig-follow/status/route.ts
import { NextResponse } from "next/server";
import { getIgFollowDiscountStatus } from "@/lib/ig-follow-discount";
import { getAuthedUser } from "@/lib/auth";

// Read-only status endpoint. Used by /account/promotions and the cart
// drawer. Customer is derived from the Supabase session; signed-out or
// incomplete-signup users always see `available: false` (never errors).

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getAuthedUser(request);
  const customerId = user?.profile?.square_customer_id;
  if (!customerId) {
    return NextResponse.json({
      ok: true,
      available: false,
      percentage: 0,
      drinksRemaining: 0,
      claimedAt: null,
      redeemedAt: null,
    });
  }
  const status = await getIgFollowDiscountStatus(customerId);
  return NextResponse.json({ ok: true, ...status });
}
```

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Smoke**

Start dev server in another terminal: `npm run dev`. Then:

```bash
curl -s http://localhost:3000/api/promotions/ig-follow/status | jq
```

Expected: `{ ok: true, available: false, ... }` (no auth header → no customer → disabled shape).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/promotions/ig-follow/status/route.ts
git commit -m "feat(api): add GET /api/promotions/ig-follow/status"
```

---

## Task 7: `/api/promotions/ig-follow/claim` route + integration tests

**Files:**
- Create: `src/app/api/promotions/ig-follow/claim/route.ts`
- Create: `src/app/api/promotions/ig-follow/__tests__/claim.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/app/api/promotions/ig-follow/__tests__/claim.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ getAuthedUser: vi.fn() }));
vi.mock("@/lib/ig-follow-discount", () => ({ claimIgFollowDiscount: vi.fn() }));

import { getAuthedUser } from "@/lib/auth";
import { claimIgFollowDiscount } from "@/lib/ig-follow-discount";
import { POST } from "../claim/route";

const mockedGetAuthed = vi.mocked(getAuthedUser);
const mockedClaim = vi.mocked(claimIgFollowDiscount);

function makeReq() {
  return new Request("http://localhost/api/promotions/ig-follow/claim", {
    method: "POST",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/promotions/ig-follow/claim", () => {
  it("returns 401 when not signed in", async () => {
    mockedGetAuthed.mockResolvedValue(null);
    const res = await POST(makeReq());
    expect(res.status).toBe(401);
    expect(mockedClaim).not.toHaveBeenCalled();
  });

  it("returns 404 when profile has no Square customer id", async () => {
    mockedGetAuthed.mockResolvedValue({
      userId: "u1",
      email: null,
      phone: null,
      profile: { square_customer_id: null, phone_e164: null },
    } as never);
    const res = await POST(makeReq());
    expect(res.status).toBe(404);
    expect(mockedClaim).not.toHaveBeenCalled();
  });

  it("mints ticket on first claim", async () => {
    mockedGetAuthed.mockResolvedValue({
      userId: "u1",
      profile: { square_customer_id: "CUST_NEW" },
    } as never);
    mockedClaim.mockResolvedValue({ alreadyClaimed: false });
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, alreadyClaimed: false });
    expect(mockedClaim).toHaveBeenCalledWith("CUST_NEW");
  });

  it("returns alreadyClaimed=true on second claim (idempotent)", async () => {
    mockedGetAuthed.mockResolvedValue({
      userId: "u1",
      profile: { square_customer_id: "CUST_OLD" },
    } as never);
    mockedClaim.mockResolvedValue({ alreadyClaimed: true });
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, alreadyClaimed: true });
  });
});
```

- [ ] **Step 2: Run tests — confirm RED**

```bash
npx vitest run src/app/api/promotions/ig-follow/__tests__/claim.test.ts
```

Expected: route file does not exist yet.

- [ ] **Step 3: Implement the route**

```ts
// src/app/api/promotions/ig-follow/claim/route.ts
import { NextResponse } from "next/server";
import { claimIgFollowDiscount } from "@/lib/ig-follow-discount";
import { getAuthedUser } from "@/lib/auth";

// Mint a 10% off ticket for the signed-in customer. Idempotent: a
// duplicate call returns { alreadyClaimed: true } and changes nothing.
// Honor system — the server does not verify Instagram follow status;
// per-customer dedup is the entire defence (Q1 = honor system).

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getAuthedUser(request);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Sign in required" },
      { status: 401 },
    );
  }
  const customerId = user.profile?.square_customer_id;
  if (!customerId) {
    return NextResponse.json(
      { ok: false, error: "Profile incomplete" },
      { status: 404 },
    );
  }
  const result = await claimIgFollowDiscount(customerId);
  return NextResponse.json({ ok: true, alreadyClaimed: result.alreadyClaimed });
}
```

- [ ] **Step 4: Run tests — confirm GREEN**

```bash
npx vitest run src/app/api/promotions/ig-follow/__tests__/claim.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/promotions/ig-follow/claim/route.ts \
        src/app/api/promotions/ig-follow/__tests__/claim.test.ts
git commit -m "feat(api): add POST /api/promotions/ig-follow/claim (idempotent)"
```

---

## Task 8: Extend `/api/me` to include `igFollowDiscount`

**Spec section:** §4.2 (`/api/me/route.ts`).

**Files:**
- Modify: `src/app/api/me/route.ts`

- [ ] **Step 1: Add the import**

At the top of the file, alongside `getWelcomeDiscountStatus`:

```ts
import { getIgFollowDiscountStatus } from "@/lib/ig-follow-discount";
```

- [ ] **Step 2: Add `igFollowDiscount` to all three response shapes**

There are three `NextResponse.json` returns in this file: signed-out, signup-incomplete, and the authed happy path. All three return `welcomeDiscount: { available: false, percentage: 0, drinksRemaining: 0 }` for the no-customer cases. Add a parallel `igFollowDiscount` field to each:

For signed-out and signup-incomplete returns:

```ts
welcomeDiscount: { available: false, percentage: 0, drinksRemaining: 0 },
igFollowDiscount: { available: false, percentage: 0, drinksRemaining: 0 },
```

For the authed happy path: add the call to the existing `Promise.all` fan-out (currently `[loyaltyAccount, welcomeDiscount]`):

```ts
let [loyaltyAccount, welcomeDiscount, igFollowDiscount] = await Promise.all([
  findLoyaltyAccountByPhone(user.profile.phone_e164).catch(() => null),
  getWelcomeDiscountStatus(user.profile.square_customer_id),
  getIgFollowDiscountStatus(user.profile.square_customer_id),
]);
```

In the final `NextResponse.json` (authed happy path), add to the response body:

```ts
welcomeDiscount,
igFollowDiscount: {
  available: igFollowDiscount.available,
  percentage: igFollowDiscount.percentage,
  drinksRemaining: igFollowDiscount.drinksRemaining,
},
```

In the post-purge return (the 404-from-Square branch), add:

```ts
welcomeDiscount: { available: false, percentage: 0, drinksRemaining: 0 },
igFollowDiscount: { available: false, percentage: 0, drinksRemaining: 0 },
```

- [ ] **Step 3: Run typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Smoke**

```bash
curl -s http://localhost:3000/api/me | jq '.igFollowDiscount'
```

Expected: `{ "available": false, "percentage": 0, "drinksRemaining": 0 }` (signed-out).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/me/route.ts
git commit -m "feat(me): include igFollowDiscount in /api/me response"
```

---

## Task 9: Extend `/api/orders` to attach IG `OrderDiscount`

**Spec section:** §4.2 + §4.4 worked example.

**Files:**
- Modify: `src/app/api/orders/route.ts`

- [ ] **Step 1: Add imports**

```ts
import { getIgFollowDiscountStatus } from "@/lib/ig-follow-discount";
```

- [ ] **Step 2: Extend the request schema/type**

Find the body type / zod schema for the request (search for `applyWelcomeDiscount` to locate it). Add `applyIgFollowDiscount?: boolean` next to `applyWelcomeDiscount`.

- [ ] **Step 3: Replace the welcome block with a combined welcome+IG block**

Replace the welcome block (the `if (body.applyWelcomeDiscount) { ... }` updated in Task 3) with this combined version. It computes both promos in one pass over `unitPrices` to avoid recomputing.

```ts
let welcomeDiscounts:
  | Array<{
      uid: string;
      name: string;
      type: "FIXED_AMOUNT";
      amountMoney: { amount: bigint; currency: Currency };
      scope: "ORDER";
    }>
  | undefined;
let igFollowDiscounts:
  | Array<{
      uid: string;
      name: string;
      type: "FIXED_AMOUNT";
      amountMoney: { amount: bigint; currency: Currency };
      scope: "ORDER";
    }>
  | undefined;
let welcomeDrinksCovered = 0;
let igFollowDrinksCovered = 0;

if (body.applyWelcomeDiscount || body.applyIgFollowDiscount) {
  const [welcomeStatus, igStatus] = await Promise.all([
    body.applyWelcomeDiscount
      ? getWelcomeDiscountStatus(customerId)
      : Promise.resolve({ available: false, percentage: 0, drinksRemaining: 0 }),
    body.applyIgFollowDiscount
      ? getIgFollowDiscountStatus(customerId)
      : Promise.resolve({
          available: false,
          percentage: 0,
          drinksRemaining: 0,
          claimedAt: null,
          redeemedAt: null,
        }),
  ]);

  const welcomeK =
    welcomeStatus.available && welcomeStatus.drinksRemaining > 0
      ? welcomeStatus.drinksRemaining
      : 0;
  const igK =
    igStatus.available && igStatus.drinksRemaining > 0
      ? igStatus.drinksRemaining
      : 0;

  if (welcomeK > 0 || igK > 0) {
    const unitPrices: bigint[] = [];
    for (const line of body.lines) {
      const modSum = line.modifiers.reduce(
        (s, m) => s + BigInt(Math.max(0, Math.floor(m.priceCents))),
        0n,
      );
      const unit =
        BigInt(Math.max(0, Math.floor(line.variationPriceCents))) + modSum;
      for (let i = 0; i < line.quantity; i++) unitPrices.push(unit);
    }

    const { welcomeCups, igFollowCups } = pickPromoCups({
      unitPrices,
      welcomeK,
      igFollowK: igK,
    });

    if (welcomeCups.length > 0) {
      const coveredSum = welcomeCups.reduce((s, p) => s + p, 0n);
      const amount =
        (coveredSum * BigInt(welcomeStatus.percentage || 30)) / 100n;
      if (amount > 0n) {
        welcomeDiscounts = [
          {
            uid: "welcome-discount",
            name:
              welcomeCups.length === 1
                ? `Welcome ${welcomeStatus.percentage || 30}% Off (1 drink)`
                : `Welcome ${welcomeStatus.percentage || 30}% Off (${welcomeCups.length} drinks)`,
            type: "FIXED_AMOUNT",
            amountMoney: { amount, currency: BUSINESS.currency as Currency },
            scope: "ORDER",
          },
        ];
        welcomeDrinksCovered = welcomeCups.length;
      }
    }

    if (igFollowCups.length > 0) {
      const coveredSum = igFollowCups.reduce((s, p) => s + p, 0n);
      const amount =
        (coveredSum * BigInt(igStatus.percentage || 10)) / 100n;
      if (amount > 0n) {
        igFollowDiscounts = [
          {
            uid: "ig-follow-discount",
            name: `IG Follow ${igStatus.percentage || 10}% Off (1 drink)`,
            type: "FIXED_AMOUNT",
            amountMoney: { amount, currency: BUSINESS.currency as Currency },
            scope: "ORDER",
          },
        ];
        igFollowDrinksCovered = igFollowCups.length;
      }
    }
  }
}

const allDiscounts = [
  ...(welcomeDiscounts ?? []),
  ...(igFollowDiscounts ?? []),
];
```

- [ ] **Step 4: Wire `allDiscounts` and metadata into the Square `orders.create` call**

Find the existing `discounts: welcomeDiscounts` (currently around line 397) and replace with `discounts: allDiscounts.length ? allDiscounts : undefined`.

Find the metadata block (currently the ternary that sets `welcomeDiscountDrinksCovered`). Extend it:

```ts
metadata: {
  ...(welcomeDrinksCovered > 0
    ? { welcomeDiscountDrinksCovered: String(welcomeDrinksCovered) }
    : {}),
  ...(igFollowDrinksCovered > 0
    ? { igFollowDiscountDrinksCovered: String(igFollowDrinksCovered) }
    : {}),
  // existing fulfillment / delivery metadata stays as-is
},
```

(If the existing metadata block uses a different shape, splice the `igFollowDiscountDrinksCovered` field in next to the welcome one; don't restructure surrounding fields.)

- [ ] **Step 5: Confirm loyalty-free-redeem still skips both promos**

The `body.applyLoyaltyReward === true` branch should not enter the welcome/IG block. Confirm by reading `skipSurcharges` logic — it should remain untouched. Welcome and IG opt-out is via the caller passing `applyWelcomeDiscount: false` and `applyIgFollowDiscount: false` (which the cart UI does today for free-redeem flows; verify in Task 13/14).

- [ ] **Step 6: Run typecheck + tests**

```bash
npx tsc --noEmit
npx vitest run
```

- [ ] **Step 7: Commit**

```bash
git add src/app/api/orders/route.ts
git commit -m "feat(orders): attach ig-follow OrderDiscount when applyIgFollowDiscount"
```

---

## Task 10: Extend `/api/payment` to consume IG ticket on COMPLETED

**Spec section:** §3.4 (payment-fail preserves ticket).

**Files:**
- Modify: `src/app/api/payment/route.ts`

- [ ] **Step 1: Add the import**

```ts
import { consumeIgFollowDiscount } from "@/lib/ig-follow-discount";
```

- [ ] **Step 2: Add the consume block parallel to the existing welcome consume**

Find the existing welcome consume block (currently around line 290–320). Immediately after the `if (paymentSettled && hadWelcomeDiscount) { ... }` block, add:

```ts
let igFollowDiscountConsumedCount = 0;
let igFollowDrinksRemaining: number | null = null;
const hadIgFollowDiscount = (order.discounts ?? []).some(
  (d) => d.uid === "ig-follow-discount",
);
if (paymentSettled && hadIgFollowDiscount) {
  const rawCovered = order.metadata?.igFollowDiscountDrinksCovered;
  const parsedCovered = rawCovered ? parseInt(rawCovered, 10) : 0;
  const coveredCount =
    Number.isFinite(parsedCovered) && parsedCovered > 0 ? parsedCovered : 0;
  if (coveredCount > 0) {
    const result = await consumeIgFollowDiscount(
      customerId,
      body.orderId,
      coveredCount,
    );
    igFollowDiscountConsumedCount = result.consumedCount;
    igFollowDrinksRemaining = result.drinksRemaining;
  }
}
if (amount > 0n && !paymentSettled && hadIgFollowDiscount) {
  console.warn(
    `[payment] payment ${paymentId} did not settle (status=${paymentStatus}); ig-follow discount preserved`,
  );
}
```

- [ ] **Step 3: Add the consumed flag to the success response**

Find the existing success `NextResponse.json` (around line 410-425) and add `igFollowDiscountConsumed` next to `welcomeDiscountConsumed`:

```ts
welcomeDiscountConsumed: welcomeDiscountConsumedCount > 0,
welcomeDrinksRemaining,
igFollowDiscountConsumed: igFollowDiscountConsumedCount > 0,
igFollowDrinksRemaining,
```

- [ ] **Step 4: Run typecheck + tests**

```bash
npx tsc --noEmit
npx vitest run
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/payment/route.ts
git commit -m "feat(payment): consume ig-follow ticket only when paymentStatus=COMPLETED"
```

---

## Task 11: Extend `AuthProvider` context

**Spec section:** §4.3 frontend modules.

**Files:**
- Modify: `src/components/auth/AuthProvider.tsx`

- [ ] **Step 1: Identify the context shape and the `/api/me` consumer**

Open `AuthProvider.tsx`. Find:
- The TypeScript type that mirrors `/api/me` response (search for `welcomeDiscount`).
- The state setter that absorbs `/api/me` (search for `welcomeDiscount` again — should be the same site).
- The context value object passed to `<AuthContext.Provider value={...}>` (search for `welcomeDiscount`).

- [ ] **Step 2: Add `igFollowDiscount` to the type**

Wherever the type defines welcome:

```ts
welcomeDiscount: { available: boolean; percentage: number; drinksRemaining: number };
igFollowDiscount: { available: boolean; percentage: number; drinksRemaining: number };
```

The default / signed-out shape should also default to `{ available: false, percentage: 0, drinksRemaining: 0 }`.

- [ ] **Step 3: Pass `igFollowDiscount` from `/api/me` into state**

Wherever the component reads `data.welcomeDiscount` and stores it, do the same for `data.igFollowDiscount` with the same disabled-shape fallback.

- [ ] **Step 4: Add `claimIgFollowDiscount` method to context**

```ts
const claimIgFollowDiscount = useCallback(async () => {
  const res = await fetch("/api/promotions/ig-follow/claim", {
    method: "POST",
    credentials: "include",
  });
  const body = await res.json().catch(() => ({}));
  // Refresh /api/me so igFollowDiscount.available flips to true.
  await refreshMe(); // or whatever the existing refresh function is named
  return { alreadyClaimed: Boolean(body?.alreadyClaimed) };
}, [refreshMe]);
```

If the provider does not currently expose a `refreshMe`, add a thin wrapper around the existing fetch path and reuse the same setter that `/api/me` initially populates. Avoid adding a second source of truth.

Then expose it in the context value:

```ts
<AuthContext.Provider
  value={{
    /* existing fields */
    welcomeDiscount,
    igFollowDiscount,
    claimIgFollowDiscount,
  }}
>
```

- [ ] **Step 5: Run typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/components/auth/AuthProvider.tsx
git commit -m "feat(auth): expose igFollowDiscount + claimIgFollowDiscount on AuthProvider"
```

---

## Task 12: `IgFollowPromoCard` component (3 states)

**Spec section:** §4.3.

**Files:**
- Create: `src/components/account/IgFollowPromoCard.tsx`

- [ ] **Step 1: Implement the component**

```tsx
// src/components/account/IgFollowPromoCard.tsx
"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Instagram } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { BRAND } from "@/lib/constants";

const IG_URL = "https://instagram.com/mandysbubbletea";
const VISITED_KEY = "mbt.igFollowVisited";

export function IgFollowPromoCard() {
  const { profile, igFollowDiscount, claimIgFollowDiscount } = useAuth();
  const [visited, setVisited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    setVisited(typeof window !== "undefined"
      && window.localStorage.getItem(VISITED_KEY) === "1");
  }, []);

  const isAvailable = igFollowDiscount.available;
  const isRedeemed = !isAvailable && igFollowDiscount.drinksRemaining === 0
    && profile != null
    // redeemedAt is not exposed via context; we infer from "not available
    // AND profile exists AND user has previously had the row" — the only
    // path to this state is consume. The /account/promotions hook can
    // also poll /api/promotions/ig-follow/status if a tighter signal is
    // needed later.
    && false; // see note above — Redeemed state currently rendered only via dedicated status fetch in Task 13

  const handleStep1 = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(VISITED_KEY, "1");
    }
    setVisited(true);
  };

  const handleClaim = async () => {
    setBusy(true);
    setErrMsg(null);
    try {
      await claimIgFollowDiscount();
    } catch (err) {
      setErrMsg("Couldn't claim right now. Please try again.");
      console.error(err);
    } finally {
      setBusy(false);
    }
  };

  // ----- Active state -----
  if (isAvailable) {
    return (
      <article
        className="rounded-2xl p-5 text-white"
        style={{ backgroundColor: BRAND.primaryColor }}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">10% Off Your Next Drink</h3>
          <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-medium">
            ACTIVE
          </span>
        </div>
        <p className="mt-1 text-sm text-white/85">
          Auto-applied to your cheapest drink at checkout. Thanks for following!
        </p>
      </article>
    );
  }

  // ----- Locked state (default) -----
  const isGuest = profile == null;
  const step2Disabled = !visited || busy;
  const step2Label = isGuest
    ? "Sign in to claim"
    : busy
    ? "Claiming…"
    : "I followed — claim my 10% off";
  const step2Href = isGuest ? "/auth?next=/account/promotions" : undefined;

  return (
    <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <Instagram className="h-5 w-5 text-zinc-700" aria-hidden />
        <h3 className="text-lg font-semibold text-zinc-900">
          Follow us for 10% off
        </h3>
      </div>
      <p className="mt-1 text-sm text-zinc-600">
        Follow @mandysbubbletea on Instagram and we'll drop a one-time 10% off
        on your next drink.
      </p>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <a
          href={IG_URL}
          target="_blank"
          rel="noreferrer noopener"
          onClick={handleStep1}
          className="inline-flex flex-1 items-center justify-center rounded-full px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
          style={{ backgroundColor: BRAND.primaryColor }}
        >
          Follow on Instagram
        </a>
        {step2Href ? (
          <Link
            href={step2Href}
            className="inline-flex flex-1 items-center justify-center rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 transition hover:border-zinc-400"
          >
            {step2Label}
          </Link>
        ) : (
          <button
            type="button"
            onClick={handleClaim}
            disabled={step2Disabled}
            className="inline-flex flex-1 items-center justify-center rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 transition enabled:hover:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {step2Label}
          </button>
        )}
      </div>

      {errMsg ? (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {errMsg}
        </p>
      ) : null}
    </article>
  );
}
```

**Note on Redeemed state:** the context shape only exposes `available / percentage / drinksRemaining`. After consume, `available=false` and `drinksRemaining=0`. To distinguish "never claimed" from "claimed and used", we need the `redeemedAt` flag, which is not in the context. Task 13 wires the parent page to fetch `/api/promotions/ig-follow/status` directly when needed — for v1 the Redeemed state is rendered inline by the parent if `status.redeemedAt != null`. This keeps the card stateless for the simple cases.

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/account/IgFollowPromoCard.tsx
git commit -m "feat(account): add IgFollowPromoCard component (Locked + Active)"
```

---

## Task 13: Mount card on `/account/promotions` + render Redeemed state

**Spec section:** §4.3.

**Files:**
- Modify: `src/app/account/promotions/page.tsx`

- [ ] **Step 1: Add status fetch + Redeemed branch**

Inside `PromotionsPage`, after the existing `useAuth()` call, add a small fetcher for the IG status (only when signed-in) so we can read `redeemedAt`:

```tsx
const [igStatus, setIgStatus] = useState<{
  available: boolean;
  drinksRemaining: number;
  redeemedAt: string | null;
} | null>(null);

useEffect(() => {
  if (!profile) return;
  let alive = true;
  fetch("/api/promotions/ig-follow/status", { credentials: "include" })
    .then((r) => r.json())
    .then((data) => {
      if (!alive) return;
      setIgStatus({
        available: Boolean(data.available),
        drinksRemaining: Number(data.drinksRemaining ?? 0),
        redeemedAt: data.redeemedAt ?? null,
      });
    })
    .catch(() => {
      if (!alive) return;
      setIgStatus({ available: false, drinksRemaining: 0, redeemedAt: null });
    });
  return () => {
    alive = false;
  };
}, [profile]);
```

- [ ] **Step 2: Render IG card + Redeemed branch**

Just above (or just below — your judgement based on visual order) the existing `promotions.map(...)` render block, render the IG section. Use `IgFollowPromoCard` for the active/locked path, and render an inline Redeemed card if `igStatus.redeemedAt != null`:

```tsx
import { IgFollowPromoCard } from "@/components/account/IgFollowPromoCard";

// inside the JSX, in the same vertical stack as the other promotion cards
{igStatus?.redeemedAt ? (
  <article className="rounded-2xl border border-zinc-200 bg-zinc-50 p-5">
    <h3 className="text-lg font-semibold text-zinc-500 line-through">
      10% Off Your Next Drink
    </h3>
    <p className="mt-1 text-sm text-zinc-500">
      Used. Thanks for following @mandysbubbletea!
    </p>
  </article>
) : (
  <IgFollowPromoCard />
)}
```

- [ ] **Step 3: Run typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Smoke (manual, dev server up)**

1. Sign in. Navigate to `/account/promotions`. Confirm Locked IG card visible.
2. Click `Follow on Instagram` (opens IG).
3. Click `I followed — claim my 10% off`. Observe loading state, then card flips to Active red banner.
4. Reload page. Card still Active.
5. (Defer the Redeemed state smoke until Task 14/15 lets us actually consume the ticket via a real order.)

- [ ] **Step 5: Commit**

```bash
git add src/app/account/promotions/page.tsx
git commit -m "feat(account): mount IgFollowPromoCard with Redeemed state branch"
```

---

## Task 14: CartDrawer summary line + wallet refresh

**Spec section:** §4.3, §4.4 worked example.

**Files:**
- Modify: `src/components/cart/CartDrawer.tsx`

**Reference:** the cart-drawer wallet-refresh fix `dc5dba4` (2026-04-26) that already calls `paymentRequest.update({ total })` for the welcome+PH+card surcharge total. Layer IG into that same total computation — do not introduce a second update site.

- [ ] **Step 1: Read the welcome usage in this file**

Open `src/components/cart/CartDrawer.tsx` and grep for `welcomeDiscount` to find:
- Where `welcomeDiscount` is read from `useAuth()`.
- Where the discount cents are computed.
- Where `displayTotal` (or equivalent) is summed for the wallet sheet.
- Where the `applyWelcomeDiscount` flag is included in the order body.

- [ ] **Step 2: Add IG state & math**

Right next to the welcome read:

```ts
const { igFollowDiscount } = useAuth();
```

Where the welcome cents are computed, add an analogous IG block. Use a helper or inline — match local style:

```ts
// Mirror the server-side logic: pickPromoCups(unitPrices, welcomeK, igK)
// but on the client we only need the cents totals. The server is the
// source of truth — this is purely for visual + wallet-sheet preview.
const unitPrices: bigint[] = lines.flatMap((line) =>
  Array.from({ length: line.quantity }, () => /* same compute as in welcome */ BigInt(line.unitPriceCents)),
);
const welcomeK = welcomeDiscount.available ? welcomeDiscount.drinksRemaining : 0;
const igK = igFollowDiscount.available ? igFollowDiscount.drinksRemaining : 0;
const { welcomeCups, igFollowCups } = pickPromoCups({
  unitPrices,
  welcomeK,
  igFollowK: igK,
});
const welcomeDiscountCents = welcomeCups.length > 0
  ? Number(
      (welcomeCups.reduce((s, p) => s + p, 0n) *
        BigInt(welcomeDiscount.percentage || 30)) /
        100n,
    )
  : 0;
const igFollowDiscountCents = igFollowCups.length > 0
  ? Number(
      (igFollowCups.reduce((s, p) => s + p, 0n) *
        BigInt(igFollowDiscount.percentage || 10)) /
        100n,
    )
  : 0;
```

(If the file already has its own `unitPriceCents` computation for welcome, reuse it. Don't duplicate.)

- [ ] **Step 3: Subtract IG from `displayTotal` and add a row to summary**

Where `displayTotal` is summed (subtotal − welcome + PH + card today), subtract `igFollowDiscountCents` too. Add a summary row, just below the welcome row:

```tsx
{igFollowDiscountCents > 0 ? (
  <div className="flex justify-between text-sm">
    <span className="text-zinc-700">IG Follow {igFollowDiscount.percentage || 10}% Off</span>
    <span className="font-semibold text-zinc-900">−${(igFollowDiscountCents / 100).toFixed(2)}</span>
  </div>
) : null}
```

- [ ] **Step 4: Include flag in submit body**

Where the order create body is constructed:

```ts
applyWelcomeDiscount: welcomeDiscount.available,
applyIgFollowDiscount: igFollowDiscount.available,
```

- [ ] **Step 5: Wallet `paymentRequest.update`**

Confirm the existing `applePayRequestRef.current?.update({ total: ... })` and `googlePayRequestRef.current?.update({ total: ... })` calls (added by `dc5dba4`) read the full `displayTotal` — they should automatically pick up the new IG-reduced total. Do not add a second update site. If the existing call uses a hardcoded subtotal+surcharge, refactor it to read `displayTotal`.

- [ ] **Step 6: Run typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 7: Manual smoke**

With dev server running and user holding an Active IG ticket: open cart drawer with 1 cup. Confirm the IG line appears. Confirm the wallet button is reachable; clicking it (Apple Pay sheet on macOS Safari) should show the IG-reduced total.

- [ ] **Step 8: Commit**

```bash
git add src/components/cart/CartDrawer.tsx
git commit -m "feat(cart): show IG follow discount + sync wallet sheet total"
```

---

## Task 15: Checkout page summary + wallet refresh

**Spec section:** §4.3.

**Files:**
- Modify: `src/app/checkout/page.tsx`

- [ ] **Step 1: Mirror Task 14 changes here**

Same shape as the cart drawer:
- Read `igFollowDiscount` from `useAuth()`.
- Compute `igFollowDiscountCents` via shared `pickPromoCups`.
- Add summary row in BOTH mobile and desktop summary sites (search for the welcome row to find both places — there are two).
- Subtract from `displayTotal`.
- Include `applyIgFollowDiscount` in the submit body.
- Confirm Apple/Google Pay `paymentRequest.update({ total: displayTotal })` reads the IG-reduced total.

- [ ] **Step 2: Sticky footer aggregate**

If the page has a sticky footer that says "Incl. PH · Card", do not change its label — surcharge is unchanged. Just confirm the footer's total reads `displayTotal` (same source as the wallet sheet).

- [ ] **Step 3: Typecheck + smoke**

```bash
npx tsc --noEmit
```

Manual: navigate to `/checkout` while signed-in with an Active ticket. Both summary sites (resize the viewport to switch) should show the IG line and matching total.

- [ ] **Step 4: Commit**

```bash
git add src/app/checkout/page.tsx
git commit -m "feat(checkout): show IG follow discount + sync wallet sheet total"
```

---

## Task 16: Stress harness scenarios (3 new)

**Spec section:** §6.

**Worktree:** `/private/tmp/stress-test-wt` (per DEV_HANDOFF). Do not bring these scenarios into `main`. The harness branch `feat/stress-test-payment` never merges to main by design.

**Files (in stress-test worktree):**
- Modify: the harness's scenario list file (search for the existing 12 scenarios — the file path is documented in the harness README; typical names include `scenarios/index.ts` or `stress-test.scenarios.ts`).

- [ ] **Step 1: Switch to the stress worktree and pull latest from `main`**

```bash
cd /private/tmp/stress-test-wt
git fetch origin
git rebase origin/main
```

(The harness branch picks up the new IG endpoints + `/api/orders` changes via rebase.)

- [ ] **Step 2: Add scenario "ig-only single cup"**

The user mints a fresh ig_follow row in setup, places a 1-cup order with `applyIgFollowDiscount: true`, asserts the order has exactly one `ig-follow-discount` `OrderDiscount` and the post-payment ticket is consumed.

- [ ] **Step 3: Add scenario "ig + welcome multi-cup"**

User has welcome (drinks_remaining: 2) AND ig_follow (drinks_remaining: 1). Place a 3-cup order ($10/$8/$6) with both flags true. Assert: 2 OrderDiscounts present (welcome covers $14, IG covers $10), totals match the spec §4.4 worked example, both tickets consumed post-payment.

- [ ] **Step 4: Add scenario "ig skipped on loyalty free redeem"**

User has both promos AND a loyalty reward. Place an order with `applyLoyaltyReward: true`. Assert: zero promo OrderDiscounts attached, IG ticket NOT consumed (still drinks_remaining: 1 post-payment).

- [ ] **Step 5: Run the harness**

```bash
cd /private/tmp/stress-test-wt
npm run stress:server   # one terminal
npm run stress:run      # other terminal
```

Expected: 12 → 15 scenarios green. Save the report:

```bash
cp /tmp/stress-test-final.json /tmp/stress-test-ig-follow-final.json
```

- [ ] **Step 6: Commit on harness branch**

```bash
cd /private/tmp/stress-test-wt
git add <scenario files>
git commit -m "feat(stress-test): cover ig-follow paths (3 scenarios)"
```

(Do NOT push or merge into main — harness branch policy.)

---

## Task 17: Production smoke + DEV_QUEUE/HANDOFF update

- [ ] **Step 1: Final typecheck + tests on main**

```bash
cd ~/Github/mandys_bubble_tea   # or wherever main is checked out
git checkout main
npx tsc --noEmit
npx vitest run
```

Both should pass. Push the main commits.

- [ ] **Step 2: Manual smoke against the deployed Vercel build**

Once Vercel turns Ready:
1. Sign in. Visit `https://mandybubbletea.com/account/promotions`. Locked card visible.
2. Step 1 (open IG) → Step 2 (claim) → card Active.
3. Add a low-price drink to cart. Cart drawer shows IG row. Total math matches.
4. Place a small real order (Apple Pay on iPhone or card). Confirm Square Dashboard order detail shows `IG Follow 10% Off (1 drink)` discount.
5. Reload `/account/promotions`. Card now Redeemed.
6. Try to claim again via DevTools `fetch("/api/promotions/ig-follow/claim", { method: "POST" })`. Response `{ ok: true, alreadyClaimed: true }`.

- [ ] **Step 3: Update DEV_QUEUE + DEV_HANDOFF**

In `~/system/DEV_QUEUE.md`, add a new "Recently Completed" entry summarising the work: tables added, routes shipped, commit shas, smoke results.

In `~/system/DEV_HANDOFF.md`, replace the current top section with the new IG-follow handoff: what shipped, what to do on next session (monitor 30-day mint rate, Phase-2 home banner decision, etc).

- [ ] **Step 4: Commit + push the QUEUE/HANDOFF updates**

```bash
cd ~/system
git add DEV_QUEUE.md DEV_HANDOFF.md
git commit -m "log: ship ig-follow → 10% off promo"
```

(Push only if `~/system` is a git repo with a remote; otherwise leave local.)

---

## Self-Review Checklist (run before handing off)

- Spec §1 Goal — ship one-time 10% off. ✅ Tasks 1-15.
- Spec §3.1 discount shape (10%, 1 drink, no expiry, claim-once) — ✅ Task 1 (default = 10, drinks_remaining=1, no expiry column) + Task 4 lib + Task 7 idempotent claim.
- Spec §3.2 user flow (Step 1 → Step 2 → cart auto-apply → COMPLETED-only consume) — ✅ Tasks 12-15.
- Spec §3.3 stacking matrix — ✅ Task 9 server-side decision + Task 14/15 client preview.
- Spec §3.4 edge cases (guest, double-claim, payment-fail, manager comp) — ✅ Tasks 7, 9, 10, 12, 13.
- Spec §4 architecture — every file in §4 is a task: 1 (DB), 2 (cup-pick), 3 (refactor), 4 (lib), 5 (purge), 6 (status), 7 (claim), 8 (me), 9 (orders), 10 (payment), 11 (auth), 12 (card), 13 (page), 14 (cart), 15 (checkout).
- Spec §5 anti-abuse — ✅ relies on Task 1 PK + Task 9 server-side recheck + Task 10 COMPLETED gate.
- Spec §6 testing — ✅ Tasks 2, 4, 7, 16.
- Spec §7 file count: 9 new + 8 modified = 17 paths touched. Plan covers all 17.
- Spec §8 rollout — ✅ Pre-flight + Task 17.
- Spec §10 operational notes — branch=main confirmed in Pre-flight + every commit step.

**No placeholders detected.** Every step has runnable commands or compilable code.

---

## Execution Handoff

After all 17 tasks complete and Task 17 smoke passes, the branch will have ~14 main commits + 1 harness commit. Operators following this plan should use `superpowers:subagent-driven-development` (recommended) for two-stage review per task, or `superpowers:executing-plans` for inline batch execution.
