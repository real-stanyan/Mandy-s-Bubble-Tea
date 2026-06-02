# Multi-Cup Loyalty Reward Redemption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow customers with N×9+ stars to redeem N free drinks on a single order via a stepper UI on both web and app, with server-side all-or-nothing rollback on failure.

**Architecture:** Web `/api/loyalty/redeem` route grows a `count` body field and loops `loyalty.rewards.create` N times against the same order, rolling back via `loyalty.rewards.delete` if any create fails. The shared `pickPromoCups` helper (separate copies in web + app repos) gains a `loyaltyRewardCount` parameter that strips the cheapest N cups before computing welcome / IG cups. Both clients replace the boolean `useReward` toggle with a `rewardCount: number` stepper bounded by `min(floor(stars/9), cupCount)`. Backward compat preserved: legacy clients sending `applyLoyaltyReward: boolean` still work, server returns both `loyaltyRewardId` (first id) and `loyaltyRewardIds: string[]` for old/new readers.

**Tech Stack:** Next.js 14 App Router (web), React Native + Expo Router (app), Square Loyalty API v44, vitest (web + app).

**Spec:** `docs/superpowers/specs/2026-05-07-multi-loyalty-reward-redeem-design.md`

**Repo layout:**
- Web: `~/Github/mandys_bubble_tea-hours` worktree on `main` (clean) — owns server endpoints + web client.
- App: `~/Github/mandys_bubble_tea_app-main` worktree on `release/v1.1.1-platform-fee` (or any clean main worktree — verify before T7).

---

## Phase 1 — Web (server + client)

### Task 1: Web pickPromoCups gets `loyaltyRewardCount` parameter

**Files:**
- Modify: `~/Github/mandys_bubble_tea-hours/src/lib/promo-cup-pick.ts`
- Modify: `~/Github/mandys_bubble_tea-hours/src/lib/promo-cup-pick.test.ts`

**Why:** Adding a third "picker" so callers get reward / welcome / IG cup arrays in one call. Reward eats the cheapest N first, welcome/IG run on the remainder using the existing welcome-wins-over-IG rule.

- [ ] **Step 1: Write failing tests**

Append these cases to `src/lib/promo-cup-pick.test.ts` (inside the existing `describe("pickPromoCups", ...)` block):

```typescript
  it("loyaltyRewardCount=0 leaves existing behavior unchanged", () => {
    const result = pickPromoCups({
      unitPrices: [600n, 800n, 1000n],
      welcomeK: 1,
      igFollowK: 0,
      loyaltyRewardCount: 0,
    });
    expect(result.loyaltyRewardCups).toEqual([]);
    expect(result.welcomeCups).toEqual([600n]);
    expect(result.igFollowCups).toEqual([]);
  });

  it("loyaltyRewardCount=2 takes the cheapest two; welcome takes next-cheapest", () => {
    const result = pickPromoCups({
      unitPrices: [600n, 800n, 1000n],
      welcomeK: 1,
      igFollowK: 0,
      loyaltyRewardCount: 2,
    });
    expect(result.loyaltyRewardCups).toEqual([600n, 800n]);
    expect(result.welcomeCups).toEqual([1000n]);
    expect(result.igFollowCups).toEqual([]);
  });

  it("loyaltyRewardCount=2 with IG-only (no welcome): IG takes from the remainder", () => {
    const result = pickPromoCups({
      unitPrices: [600n, 800n, 1000n],
      welcomeK: 0,
      igFollowK: 1,
      loyaltyRewardCount: 2,
    });
    expect(result.loyaltyRewardCups).toEqual([600n, 800n]);
    expect(result.welcomeCups).toEqual([]);
    expect(result.igFollowCups).toEqual([1000n]);
  });

  it("loyaltyRewardCount equals cup count: welcome & IG are empty", () => {
    const result = pickPromoCups({
      unitPrices: [600n, 800n],
      welcomeK: 1,
      igFollowK: 1,
      loyaltyRewardCount: 2,
    });
    expect(result.loyaltyRewardCups).toEqual([600n, 800n]);
    expect(result.welcomeCups).toEqual([]);
    expect(result.igFollowCups).toEqual([]);
  });

  it("welcome+reward retains welcome-wins-over-IG: IG empty even with leftover cups", () => {
    const result = pickPromoCups({
      unitPrices: [600n, 800n, 1000n, 1200n],
      welcomeK: 1,
      igFollowK: 1,
      loyaltyRewardCount: 1,
    });
    expect(result.loyaltyRewardCups).toEqual([600n]);
    expect(result.welcomeCups).toEqual([800n]);
    expect(result.igFollowCups).toEqual([]);
  });

  it("loyaltyRewardCount clamps to available cup count (no over-allocation)", () => {
    const result = pickPromoCups({
      unitPrices: [600n, 800n],
      welcomeK: 0,
      igFollowK: 0,
      loyaltyRewardCount: 5,
    });
    expect(result.loyaltyRewardCups).toEqual([600n, 800n]);
    expect(result.welcomeCups).toEqual([]);
    expect(result.igFollowCups).toEqual([]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/Github/mandys_bubble_tea-hours && npx vitest run src/lib/promo-cup-pick.test.ts
```

Expected: FAIL — `loyaltyRewardCups` does not exist on result; `loyaltyRewardCount` not accepted.

- [ ] **Step 3: Update the implementation**

Replace `src/lib/promo-cup-pick.ts` body with:

```typescript
export interface PickPromoCupsArgs {
  unitPrices: bigint[];
  welcomeK: number;
  igFollowK: number;
  loyaltyRewardCount?: number;
}

export interface PickPromoCupsResult {
  loyaltyRewardCups: bigint[];
  welcomeCups: bigint[];
  igFollowCups: bigint[];
}

/**
 * Allocate cups to loyalty rewards and promotional discounts, sorted by
 * unit price (cheapest first).
 *
 * Allocation order:
 *  1. Loyalty rewards eat the cheapest `loyaltyRewardCount` cups (clamped
 *     to available cup count).
 *  2. From the remaining cups, welcome takes its share if welcomeK >= 1.
 *  3. Otherwise IG-follow takes its share if igFollowK >= 1.
 *
 * Welcome and IG-follow remain mutually exclusive at the order level:
 * when both are available the order uses welcome only and the IG ticket
 * is preserved. The chosen promo takes its share from the *cheapest* end
 * of the remaining cups.
 *
 * Caller contract:
 * - `loyaltyRewardCount` is the number of reward redemptions client wants
 *   to apply. Defaults to 0. Caller is responsible for capping it to
 *   `min(floor(stars/starsPerReward), cupCount)`.
 * - `welcomeK` and `igFollowK` are the *attempted* K values, derived
 *   per-promo from server-side ticket status. Pass `0` when a promo is
 *   unavailable. Welcome wins when both are available; the caller must
 *   therefore NOT call `consumeIgFollowDiscount` when
 *   `igFollowCups.length === 0`.
 */
export function pickPromoCups(args: PickPromoCupsArgs): PickPromoCupsResult {
  const sorted = [...args.unitPrices].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );

  const rewardTake = Math.min(
    Math.max(0, args.loyaltyRewardCount ?? 0),
    sorted.length,
  );
  const loyaltyRewardCups = sorted.slice(0, rewardTake);
  const remaining = sorted.slice(rewardTake);

  if (args.welcomeK >= 1) {
    const welcomeTake = Math.min(args.welcomeK, remaining.length);
    return {
      loyaltyRewardCups,
      welcomeCups: remaining.slice(0, welcomeTake),
      igFollowCups: [],
    };
  }

  if (args.igFollowK >= 1) {
    const igTake = Math.min(args.igFollowK, remaining.length);
    return {
      loyaltyRewardCups,
      welcomeCups: [],
      igFollowCups: remaining.slice(0, igTake),
    };
  }

  return { loyaltyRewardCups, welcomeCups: [], igFollowCups: [] };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/Github/mandys_bubble_tea-hours && npx vitest run src/lib/promo-cup-pick.test.ts
```

Expected: PASS — all original cases + 6 new cases green.

- [ ] **Step 5: Verify no other callsite broke (default param keeps existing 3 callers happy)**

```bash
cd ~/Github/mandys_bubble_tea-hours && npx tsc --noEmit
```

Expected: 0 errors. The 3 callers (`checkout/page.tsx`, `orders/route.ts`, `CartDrawer.tsx`) currently pass no `loyaltyRewardCount` — defaults to 0, return shape adds a new field they ignore.

- [ ] **Step 6: Commit**

```bash
cd ~/Github/mandys_bubble_tea-hours && git add src/lib/promo-cup-pick.ts src/lib/promo-cup-pick.test.ts && git commit -m "feat(promo-cup-pick): add loyaltyRewardCount picker

Loyalty rewards now eat the cheapest N cups before welcome/IG run
on the remainder. Default 0 keeps existing 3 callers unchanged."
```

---

### Task 2: Web `/api/orders` route accepts `loyaltyRewardCount` and passes it to pickPromoCups

**Files:**
- Modify: `~/Github/mandys_bubble_tea-hours/src/app/api/orders/route.ts`

**Why:** Without this, server-side welcome discount would land on the same cheapest cup that loyalty reward will later cover, double-discounting it. Server must agree with client on which cups belong to whom.

- [ ] **Step 1: Read the current orders route to find the body schema and pickPromoCups call**

```bash
cd ~/Github/mandys_bubble_tea-hours && grep -n "pickPromoCups\|applyLoyaltyReward\|skipSurcharges\|body\." src/app/api/orders/route.ts
```

- [ ] **Step 2: Add `loyaltyRewardCount?: number` to the body type**

Find the body type / interface (search `applyLoyaltyReward?:` near the top of the route handler). Add `loyaltyRewardCount?: number;` next to it.

- [ ] **Step 3: Pass it to pickPromoCups**

In the `pickPromoCups({ ... })` call (around line 288), add `loyaltyRewardCount: body.loyaltyRewardCount ?? 0,` to the args object.

- [ ] **Step 4: Update `skipSurcharges` to gate on rewardCount > 0 OR legacy boolean**

Find `const skipSurcharges = body.applyLoyaltyReward === true;` (around line 355). Replace with:

```typescript
const skipSurcharges =
  (body.loyaltyRewardCount ?? 0) > 0 ||
  body.applyLoyaltyReward === true;
```

This keeps old app binaries (which only send `applyLoyaltyReward`) working until the app ships.

- [ ] **Step 5: Run typecheck + tests**

```bash
cd ~/Github/mandys_bubble_tea-hours && npx tsc --noEmit && npx vitest run
```

Expected: clean typecheck, all existing tests pass (no behavior change yet — clients still send `loyaltyRewardCount` undefined).

- [ ] **Step 6: Commit**

```bash
cd ~/Github/mandys_bubble_tea-hours && git add src/app/api/orders/route.ts && git commit -m "feat(orders): accept loyaltyRewardCount, pass to pickPromoCups

Server now agrees with client on which cups belong to rewards vs
welcome/IG. Backward compat preserved: legacy applyLoyaltyReward
boolean still gates skipSurcharges."
```

---

### Task 3: Web `/api/loyalty/redeem` route accepts `count`, loops + rollback

**Files:**
- Modify: `~/Github/mandys_bubble_tea-hours/src/app/api/loyalty/redeem/route.ts`
- Create: `~/Github/mandys_bubble_tea-hours/src/app/api/loyalty/redeem/route.test.ts`

**Why:** This is the heart of the feature. Server-side loop ensures atomicity from the client's perspective and centralizes failure handling.

- [ ] **Step 1: Write failing tests**

Create `src/app/api/loyalty/redeem/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetAuthedUser = vi.fn();
const mockFindLoyaltyAccountByPhone = vi.fn();
const mockGetActiveProgram = vi.fn();
const mockRedeemReward = vi.fn();
const mockOrdersGet = vi.fn();
const mockRewardsDelete = vi.fn();

vi.mock("@/lib/auth", () => ({
  getAuthedUser: (req: Request) => mockGetAuthedUser(req),
}));
vi.mock("@/lib/loyalty", () => ({
  findLoyaltyAccountByPhone: (...args: unknown[]) =>
    mockFindLoyaltyAccountByPhone(...args),
  getActiveProgram: () => mockGetActiveProgram(),
  redeemReward: (...args: unknown[]) => mockRedeemReward(...args),
}));
vi.mock("@/lib/square", () => ({
  squareClient: {
    orders: { get: (args: unknown) => mockOrdersGet(args) },
    loyalty: {
      rewards: { delete: (args: unknown) => mockRewardsDelete(args) },
    },
  },
}));

import { POST } from "./route";

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/loyalty/redeem", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/loyalty/redeem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthedUser.mockResolvedValue({
      profile: { phone_e164: "+61400000001" },
    });
    mockFindLoyaltyAccountByPhone.mockResolvedValue({
      accountId: "acc1",
      balance: 27,
    });
    mockGetActiveProgram.mockResolvedValue({
      starsPerReward: 9,
      rewardTierId: "tier1",
    });
  });

  it("count=2 happy path: creates 2 rewards, refetches order once", async () => {
    mockRedeemReward
      .mockResolvedValueOnce({ loyaltyRewardId: "r1" })
      .mockResolvedValueOnce({ loyaltyRewardId: "r2" });
    mockOrdersGet.mockResolvedValue({
      order: {
        totalMoney: { amount: 350n },
        lineItems: [{ quantity: "3" }],
      },
    });

    // First call: cup-count check
    mockOrdersGet.mockResolvedValueOnce({
      order: { lineItems: [{ quantity: "3" }] },
    });
    // Second call: post-loop refetch
    mockOrdersGet.mockResolvedValueOnce({
      order: { totalMoney: { amount: 350n } },
    });

    const res = await POST(makeRequest({ orderId: "ord1", count: 2 }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.loyaltyRewardIds).toEqual(["r1", "r2"]);
    expect(json.loyaltyRewardId).toBe("r1");
    expect(json.remainingBalance).toBe(9);
    expect(json.updatedAmountCents).toBe("350");
    expect(mockRedeemReward).toHaveBeenCalledTimes(2);
    expect(mockRewardsDelete).not.toHaveBeenCalled();
  });

  it("count defaults to 1 when omitted (back-compat)", async () => {
    mockRedeemReward.mockResolvedValueOnce({ loyaltyRewardId: "r1" });
    mockOrdersGet
      .mockResolvedValueOnce({
        order: { lineItems: [{ quantity: "1" }] },
      })
      .mockResolvedValueOnce({
        order: { totalMoney: { amount: 0n } },
      });

    const res = await POST(makeRequest({ orderId: "ord1" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.loyaltyRewardIds).toEqual(["r1"]);
    expect(mockRedeemReward).toHaveBeenCalledTimes(1);
  });

  it("count=0 rejected as 400", async () => {
    const res = await POST(makeRequest({ count: 0 }));
    expect(res.status).toBe(400);
    expect(mockRedeemReward).not.toHaveBeenCalled();
  });

  it("count=11 rejected as 400 (exceeds 10 hard cap)", async () => {
    const res = await POST(makeRequest({ count: 11 }));
    expect(res.status).toBe(400);
    expect(mockRedeemReward).not.toHaveBeenCalled();
  });

  it("count exceeds available stars rejected as 400", async () => {
    mockFindLoyaltyAccountByPhone.mockResolvedValue({
      accountId: "acc1",
      balance: 9,
    });
    const res = await POST(makeRequest({ count: 2 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Not enough stars/);
  });

  it("count > cupCount rejected as 400", async () => {
    mockOrdersGet.mockResolvedValueOnce({
      order: { lineItems: [{ quantity: "1" }] },
    });
    const res = await POST(makeRequest({ orderId: "ord1", count: 2 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Cannot redeem 2 rewards on a 1-cup order/);
    expect(mockRedeemReward).not.toHaveBeenCalled();
  });

  it("Square fails on the 2nd create: rolls back the 1st reward, returns 502", async () => {
    mockRedeemReward
      .mockResolvedValueOnce({ loyaltyRewardId: "r1" })
      .mockRejectedValueOnce(new Error("Square 5xx"));
    mockOrdersGet.mockResolvedValueOnce({
      order: { lineItems: [{ quantity: "3" }] },
    });
    mockRewardsDelete.mockResolvedValue({});

    const res = await POST(makeRequest({ orderId: "ord1", count: 2 }));
    expect(res.status).toBe(502);
    expect(mockRedeemReward).toHaveBeenCalledTimes(2);
    expect(mockRewardsDelete).toHaveBeenCalledTimes(1);
    expect(mockRewardsDelete).toHaveBeenCalledWith({ rewardId: "r1" });
  });

  it("rollback delete failure is logged but still returns 502 with original error", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockRedeemReward
      .mockResolvedValueOnce({ loyaltyRewardId: "r1" })
      .mockRejectedValueOnce(new Error("Square 5xx"));
    mockOrdersGet.mockResolvedValueOnce({
      order: { lineItems: [{ quantity: "3" }] },
    });
    mockRewardsDelete.mockRejectedValue(new Error("delete also failed"));

    const res = await POST(makeRequest({ orderId: "ord1", count: 2 }));
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toMatch(/Square 5xx/);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[loyalty-rollback-failed]"),
      expect.anything(),
    );
    consoleSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/Github/mandys_bubble_tea-hours && npx vitest run src/app/api/loyalty/redeem/route.test.ts
```

Expected: FAIL — `count` validation, looping, rollback, cup-count check all unimplemented.

- [ ] **Step 3: Replace the route implementation**

Replace `src/app/api/loyalty/redeem/route.ts` entirely with:

```typescript
import { NextResponse } from "next/server";
import {
  redeemReward,
  getActiveProgram,
  findLoyaltyAccountByPhone,
} from "@/lib/loyalty";
import { squareClient } from "@/lib/square";
import { getAuthedUser } from "@/lib/auth";

const MAX_REWARDS_PER_ORDER = 10;

type RedeemBody = {
  orderId?: string;
  count?: number;
};

export async function POST(request: Request) {
  const user = await getAuthedUser(request);
  if (!user?.profile?.phone_e164) {
    return NextResponse.json(
      { ok: false, error: "Sign in to redeem a reward" },
      { status: 401 },
    );
  }
  const e164 = user.profile.phone_e164;

  let body: RedeemBody;
  try {
    body = (await request.json()) as RedeemBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (body.orderId !== undefined && typeof body.orderId !== "string") {
    return NextResponse.json(
      { ok: false, error: "Invalid orderId" },
      { status: 400 },
    );
  }

  const count = body.count ?? 1;
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > MAX_REWARDS_PER_ORDER
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: `count must be an integer between 1 and ${MAX_REWARDS_PER_ORDER} (got ${count})`,
      },
      { status: 400 },
    );
  }

  try {
    const account = await findLoyaltyAccountByPhone(e164);
    if (!account) {
      return NextResponse.json(
        {
          ok: false,
          error: `No loyalty account found for ${e164}. Place an order first to enroll.`,
        },
        { status: 404 },
      );
    }

    const { starsPerReward, rewardTierId } = await getActiveProgram();
    const starsNeeded = starsPerReward * count;
    if (account.balance < starsNeeded) {
      return NextResponse.json(
        {
          ok: false,
          error: `Not enough stars — you have ${account.balance}, need ${starsNeeded} for ${count} reward${count > 1 ? "s" : ""}.`,
          balance: account.balance,
          starsPerReward,
        },
        { status: 400 },
      );
    }

    if (body.orderId) {
      const preCheck = await squareClient.orders.get({
        orderId: body.orderId,
      });
      const cupCount = (preCheck.order?.lineItems ?? []).reduce(
        (sum, li) => sum + Number(li.quantity ?? "0"),
        0,
      );
      if (count > cupCount) {
        return NextResponse.json(
          {
            ok: false,
            error: `Cannot redeem ${count} rewards on a ${cupCount}-cup order.`,
          },
          { status: 400 },
        );
      }
    }

    const createdIds: string[] = [];
    let updatedAmountCents: string | null = null;
    try {
      for (let i = 0; i < count; i++) {
        const { loyaltyRewardId } = await redeemReward(
          account.accountId,
          rewardTierId,
          body.orderId,
        );
        createdIds.push(loyaltyRewardId);
      }
      if (body.orderId) {
        const refetched = await squareClient.orders.get({
          orderId: body.orderId,
        });
        const amount = refetched.order?.totalMoney?.amount;
        if (amount != null) updatedAmountCents = amount.toString();
      }
    } catch (err) {
      // Rollback every reward we created. Points return to the account
      // automatically and the order's discount lines vanish.
      const rollbacks = await Promise.allSettled(
        createdIds.map((id) =>
          squareClient.loyalty.rewards.delete({ rewardId: id }),
        ),
      );
      const failedRollbacks = rollbacks
        .map((r, i) => ({ r, id: createdIds[i] }))
        .filter((x) => x.r.status === "rejected");
      if (failedRollbacks.length > 0) {
        console.error("[loyalty-rollback-failed]", {
          rewardIds: failedRollbacks.map((x) => x.id),
          originalError: err instanceof Error ? err.message : String(err),
        });
      }
      throw err;
    }

    return NextResponse.json({
      ok: true,
      loyaltyRewardIds: createdIds,
      // Back-compat for older app binaries that read `loyaltyRewardId`
      loyaltyRewardId: createdIds[0],
      remainingBalance: account.balance - starsNeeded,
      updatedAmountCents,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/Github/mandys_bubble_tea-hours && npx vitest run src/app/api/loyalty/redeem/route.test.ts
```

Expected: PASS — all 8 cases green.

- [ ] **Step 5: Run full test suite + typecheck**

```bash
cd ~/Github/mandys_bubble_tea-hours && npx vitest run && npx tsc --noEmit
```

Expected: all green, no regressions.

- [ ] **Step 6: Commit**

```bash
cd ~/Github/mandys_bubble_tea-hours && git add src/app/api/loyalty/redeem/route.ts src/app/api/loyalty/redeem/route.test.ts && git commit -m "feat(loyalty/redeem): accept count param with all-or-nothing rollback

Server now loops loyalty.rewards.create N times against the same
order. On any failure, every successfully-created reward is deleted
to keep account balance and order state consistent. count defaults
to 1 for backward compat. MAX_REWARDS_PER_ORDER=10 hard cap.
Response includes both loyaltyRewardIds (canonical) and
loyaltyRewardId (first id, for old app readers)."
```

---

### Task 4: Web checkout page replaces `useReward` boolean with `rewardCount` stepper

**Files:**
- Modify: `~/Github/mandys_bubble_tea-hours/src/app/checkout/page.tsx`

**Why:** The actual UI customers see. Stepper bounded by `min(floor(stars/9), cupCount)`, default 0.

- [ ] **Step 1: Replace the state declaration**

Find around line 128:
```typescript
const [useReward, setUseReward] = useState(false);
```
Replace with:
```typescript
const [rewardCount, setRewardCount] = useState(0);
```

- [ ] **Step 2: Compute `maxRewardCount` near the existing loyalty derived values**

Find around line 231 (where `starsPerReward` / `loyaltyBalance` / `canRedeem` live). Replace the block:
```typescript
const starsPerReward = authStarsPerReward || LOYALTY.starsPerReward;
const loyaltyBalance = loyalty?.balance ?? 0;
const canRedeem = loyaltyBalance >= starsPerReward && starsPerReward > 0;
const starsThisOrder = lines.reduce((n, l) => n + l.quantity, 0);
const progressPct = Math.min((loyaltyBalance / starsPerReward) * 100, 100);
```
With:
```typescript
const starsPerReward = authStarsPerReward || LOYALTY.starsPerReward;
const loyaltyBalance = loyalty?.balance ?? 0;
const canRedeem = loyaltyBalance >= starsPerReward && starsPerReward > 0;
const starsThisOrder = lines.reduce((n, l) => n + l.quantity, 0);
const progressPct = Math.min((loyaltyBalance / starsPerReward) * 100, 100);
const cupCount = starsThisOrder; // 1 cup per quantity unit
const maxRewardCount = useMemo(() => {
  if (starsPerReward <= 0) return 0;
  return Math.min(
    Math.floor(loyaltyBalance / starsPerReward),
    cupCount,
  );
}, [loyaltyBalance, starsPerReward, cupCount]);
```

- [ ] **Step 3: Clamp `rewardCount` whenever `maxRewardCount` shrinks (cart edits, etc.)**

Add right after the `maxRewardCount` useMemo:
```typescript
useEffect(() => {
  if (rewardCount > maxRewardCount) setRewardCount(maxRewardCount);
}, [maxRewardCount, rewardCount]);
```

- [ ] **Step 4: Replace `rewardDiscount` useMemo to sum cheapest N**

Find around line 141:
```typescript
const rewardDiscount = useMemo(() => {
  if (lines.length === 0) return 0n;
  let cheapest = lineUnitPrice(lines[0]);
  for (const l of lines) {
    const up = lineUnitPrice(l);
    if (up < cheapest) cheapest = up;
  }
  return cheapest;
}, [lines]);
```
Replace with:
```typescript
const sortedUnitPrices = useMemo(() => {
  const cups: bigint[] = [];
  for (const line of lines) {
    const unit = lineUnitPrice(line);
    for (let i = 0; i < line.quantity; i++) cups.push(unit);
  }
  return cups.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}, [lines]);

const rewardDiscount = useMemo(
  () =>
    sortedUnitPrices
      .slice(0, rewardCount)
      .reduce((sum, p) => sum + p, 0n),
  [sortedUnitPrices, rewardCount],
);
```

- [ ] **Step 5: Pass `loyaltyRewardCount` into pickPromoCups**

Find around line 171:
```typescript
const { welcomeCups, igFollowCups } = pickPromoCups({
  unitPrices,
  welcomeK,
  igFollowK: igK,
});
```

Change the args object to read from the already-sorted `sortedUnitPrices` (and pass rewardCount). Replace the `unitPrices` collection block (lines ~160-175) with:
```typescript
const { welcomeCups, igFollowCups } = pickPromoCups({
  unitPrices: sortedUnitPrices,
  welcomeK,
  igFollowK: igK,
  loyaltyRewardCount: rewardCount,
});
```
(Delete the now-redundant local `unitPrices` accumulator above this call — `sortedUnitPrices` replaces it.)

- [ ] **Step 6: Update `displayTotal` to use the new rewardDiscount + multi-reward isFreeRedeem**

Find around line 237-266. Replace:
```typescript
const canRedeemFully = canRedeem && subtotal - rewardDiscount <= 0n;
const isFreeRedeem = canRedeemFully && useReward;

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
```
With:
```typescript
const totalDiscount =
  rewardDiscount + welcomeDiscountAmount + igFollowDiscountAmount;
const afterDiscount =
  subtotal - totalDiscount > 0n ? subtotal - totalDiscount : 0n;
const isFreeRedeem = rewardCount > 0 && afterDiscount === 0n;

const displayTotal = useMemo(() => {
  if (isFreeRedeem) return 0n;
  return afterDiscount + surchargeAmount + platformFeeAmount + phSurchargeAmount;
}, [
  isFreeRedeem,
  afterDiscount,
  surchargeAmount,
  platformFeeAmount,
  phSurchargeAmount,
]);
```

- [ ] **Step 7: Update the `effectiveSurcharge` block**

Find around line 269 (`const effectiveSurcharge = isFreeRedeem ? 0n : surchargeAmount;`). No change needed — the new `isFreeRedeem` works identically here.

- [ ] **Step 8: Update the `/api/orders` POST body to include `loyaltyRewardCount`**

Find the body sent to `/api/orders` (search for `applyLoyaltyReward:`). It currently sends `applyLoyaltyReward: useReward`. Replace with:
```typescript
applyLoyaltyReward: rewardCount > 0,
loyaltyRewardCount: rewardCount,
```
(Keep both — the boolean is the back-compat field, the count is the new one.)

- [ ] **Step 9: Update the `/api/loyalty/redeem` POST body to include `count`**

Find around line 515:
```typescript
const redeemRes = await fetch("/api/loyalty/redeem", {
```
Update its body to include `count: rewardCount` (alongside `orderId`). The `if (useReward) { ... }` gate becomes `if (rewardCount > 0) { ... }`.

- [ ] **Step 10: Replace the toggle UI with a stepper**

Find the existing "Use a reward" toggle row (search for `useReward` and `setUseReward`; should be near the loyalty card section around line 670+). Replace it with:

```tsx
{loyaltyBalance >= starsPerReward && maxRewardCount > 0 && (
  <div className="flex items-center justify-between rounded-lg border border-[#C43A10]/30 bg-[#F5E6C8]/40 px-4 py-3">
    <div>
      <div className="text-sm font-medium text-[#C43A10]">
        Use rewards
      </div>
      {rewardCount > 0 && (
        <div className="mt-0.5 text-xs text-neutral-600">
          −{formatPrice(rewardDiscount)} off {rewardCount} cheapest drink
          {rewardCount > 1 ? "s" : ""}
        </div>
      )}
    </div>
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => setRewardCount((n) => Math.max(0, n - 1))}
        disabled={rewardCount === 0}
        className="h-8 w-8 rounded-full border border-[#C43A10] text-[#C43A10] disabled:opacity-30"
        aria-label="Decrease reward count"
      >
        −
      </button>
      <span className="min-w-[1.5rem] text-center font-medium text-[#C43A10]">
        {rewardCount}
      </span>
      <button
        type="button"
        onClick={() =>
          setRewardCount((n) => Math.min(maxRewardCount, n + 1))
        }
        disabled={rewardCount === maxRewardCount}
        className="h-8 w-8 rounded-full border border-[#C43A10] text-[#C43A10] disabled:opacity-30"
        aria-label="Increase reward count"
      >
        +
      </button>
    </div>
  </div>
)}
```

(If your existing toggle component had additional copy like "Free drink available!" — preserve that copy logic, but key the visible text on `rewardCount > 0` vs `canRedeem && rewardCount === 0`.)

- [ ] **Step 11: Update order summary line for reward**

Find the existing `−{formatPrice(rewardDiscount)}` line near line 749 (and ~1004 for the duplicate summary). Update the label from "Loyalty reward" / "Free drink reward" to:
```tsx
<span>Loyalty reward {rewardCount > 1 ? `×${rewardCount}` : ""}</span>
```
And gate the row on `rewardCount > 0` instead of `useReward`.

- [ ] **Step 12: Run typecheck + tests + dev server smoke**

```bash
cd ~/Github/mandys_bubble_tea-hours && npx tsc --noEmit && npx vitest run
```

Expected: 0 errors, all tests pass.

Then start the dev server (per global rule for Mandy's UI work):
```bash
cd ~/Github/mandys_bubble_tea-hours && npm run dev
```

Open a cmux browser pane to `http://localhost:3000/checkout` (after seeding cart). Manual checks:
- Logged-in user with 0 stars — no stepper visible.
- Logged-in user with 9 stars + 3 cups — stepper shows max=1 (capped by stars).
- Logged-in user with 27 stars + 2 cups — stepper shows max=2 (capped by cups).
- Click `+` — discount line appears, displayTotal updates, Apple Pay sheet amount updates.
- Click `+` until max — `+` button disabled. Click `−` to 0 — discount line vanishes.

- [ ] **Step 13: Commit**

```bash
cd ~/Github/mandys_bubble_tea-hours && git add src/app/checkout/page.tsx && git commit -m "feat(checkout): multi-cup loyalty reward stepper

Replaces the boolean useReward toggle with a 0..N stepper bounded by
min(floor(stars/9), cupCount). rewardDiscount sums the cheapest N cup
unit prices. /api/orders body now sends loyaltyRewardCount; /api/loyalty/redeem
sends count. Welcome / IG discounts apply to the leftover cups via
pickPromoCups loyaltyRewardCount param."
```

---

### Task 5: Web CartDrawer — explicit `loyaltyRewardCount: 0` for clarity

**Files:**
- Modify: `~/Github/mandys_bubble_tea-hours/src/components/cart/CartDrawer.tsx`

**Why:** CartDrawer previews promos before checkout and never knows about reward count (selection lives on checkout page). Pass `loyaltyRewardCount: 0` explicitly so a future reader doesn't wonder if the omission is a bug.

- [ ] **Step 1: Add the explicit arg**

Find line 221:
```typescript
const { welcomeCups, igFollowCups } = pickPromoCups({
```
Inside the args object, add:
```typescript
loyaltyRewardCount: 0,
```

- [ ] **Step 2: Verify typecheck still clean**

```bash
cd ~/Github/mandys_bubble_tea-hours && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd ~/Github/mandys_bubble_tea-hours && git add src/components/cart/CartDrawer.tsx && git commit -m "chore(cart-drawer): pass explicit loyaltyRewardCount: 0 to pickPromoCups

Makes intent clear: cart drawer never knows reward selection
(stepper lives on checkout page)."
```

---

### Task 6: Web full verification + push

- [ ] **Step 1: Full test + typecheck + lint + build**

```bash
cd ~/Github/mandys_bubble_tea-hours && npx vitest run && npx tsc --noEmit && npm run lint && npm run build
```

Expected: all green. (Note: `widget-data/route.test.ts` 2 cases write `today === 2026-04-29` — pre-existing flake unrelated to this work; ignore if they fail.)

- [ ] **Step 2: Verify cmux browser smoke passed in Task 4 Step 12 — if not, do it now**

Open localhost:3000, sign in, add 3 drinks, go to checkout, exercise the stepper. Confirm:
- Order summary line "Loyalty reward ×N    −$X.XX" shows when N>0
- Apple Pay sheet (`afterDiscount + surcharges`) matches displayed total
- Place order button disables / enables correctly

- [ ] **Step 3: Push origin/main**

```bash
cd ~/Github/mandys_bubble_tea-hours && git push origin main
```

Expected: 5-6 new commits pushed. Vercel deploys automatically.

---

## Phase 2 — App (mirror web)

### Task 7: App pickPromoCups gets `loyaltyRewardCount` parameter

**Files:**
- First: verify clean app worktree, switch to it.
- Modify: `<app-worktree>/lib/promo-cup-pick.ts`
- Modify: `<app-worktree>/lib/promo-cup-pick.test.ts`

**Why:** App needs the same picker semantics as web. Critical: the app's existing implementation is divergent from web (cooperative welcome+IG instead of mutually exclusive) — DO NOT fix that divergence in this task; preserve existing behavior, only add the loyaltyRewardCount layer on top.

- [ ] **Step 0: Verify clean app worktree (use mandys_bubble_tea_app-main, on main branch and clean)**

```bash
cd ~/Github/mandys_bubble_tea_app-main && git status -sb && git branch --show-current
```

Expected: clean working tree, on main (or release branch tracking main). If dirty, run targeted-stash; if on a feature branch, switch to main: `git checkout main && git pull origin main`.

- [ ] **Step 1: Write failing tests**

Append to `lib/promo-cup-pick.test.ts`:

```typescript
  it('loyaltyRewardCount=0 leaves existing behavior unchanged', () => {
    const result = pickPromoCups({
      unitPrices: [600, 800, 1000],
      welcomeK: 1,
      igFollowK: 0,
      loyaltyRewardCount: 0,
    })
    expect(result.loyaltyRewardCups).toEqual([])
    expect(result.welcomeCups).toEqual([600])
    expect(result.igFollowCups).toEqual([])
  })

  it('loyaltyRewardCount=2 takes cheapest two; welcome takes next-cheapest', () => {
    const result = pickPromoCups({
      unitPrices: [600, 800, 1000],
      welcomeK: 1,
      igFollowK: 0,
      loyaltyRewardCount: 2,
    })
    expect(result.loyaltyRewardCups).toEqual([600, 800])
    expect(result.welcomeCups).toEqual([1000])
    expect(result.igFollowCups).toEqual([])
  })

  it('loyaltyRewardCount=2 with cooperative welcome+IG: each takes from the remainder', () => {
    // Preserves app-side cooperative behavior (different from web).
    const result = pickPromoCups({
      unitPrices: [600, 800, 1000, 1200],
      welcomeK: 1,
      igFollowK: 1,
      loyaltyRewardCount: 2,
    })
    expect(result.loyaltyRewardCups).toEqual([600, 800])
    expect(result.welcomeCups).toEqual([1000])
    expect(result.igFollowCups).toEqual([1200])
  })

  it('loyaltyRewardCount equals cup count: welcome & IG empty', () => {
    const result = pickPromoCups({
      unitPrices: [600, 800],
      welcomeK: 1,
      igFollowK: 1,
      loyaltyRewardCount: 2,
    })
    expect(result.loyaltyRewardCups).toEqual([600, 800])
    expect(result.welcomeCups).toEqual([])
    expect(result.igFollowCups).toEqual([])
  })

  it('loyaltyRewardCount clamps to available cup count', () => {
    const result = pickPromoCups({
      unitPrices: [600, 800],
      welcomeK: 0,
      igFollowK: 0,
      loyaltyRewardCount: 5,
    })
    expect(result.loyaltyRewardCups).toEqual([600, 800])
  })
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/Github/mandys_bubble_tea_app-main && npx jest lib/promo-cup-pick.test.ts
```

Expected: FAIL — `loyaltyRewardCount` not accepted, `loyaltyRewardCups` undefined.

- [ ] **Step 3: Update app implementation**

Replace `lib/promo-cup-pick.ts`:

```typescript
export interface PickPromoCupsArgs {
  unitPrices: number[]
  welcomeK: number
  igFollowK: number
  loyaltyRewardCount?: number
}

export interface PickPromoCupsResult {
  loyaltyRewardCups: number[]
  welcomeCups: number[]
  igFollowCups: number[]
}

/**
 * Allocate cups to loyalty rewards and promotional discounts, sorted
 * by unit price (cheapest first).
 *
 * Allocation order:
 *  1. Loyalty rewards eat the cheapest `loyaltyRewardCount` cups.
 *  2. From the remaining cups, welcome takes its share.
 *  3. From cups left after welcome, IG takes its share (cooperative
 *     behavior unique to app — web is mutually exclusive; this
 *     divergence is pre-existing and out of scope here).
 *
 * One-cup-with-welcome-priority rule still holds for the `remaining`
 * slice when len === 1 and both welcomeK & igFollowK >= 1.
 */
export function pickPromoCups(args: PickPromoCupsArgs): PickPromoCupsResult {
  const sorted = [...args.unitPrices].sort((a, b) => a - b)

  const rewardTake = Math.min(
    Math.max(0, args.loyaltyRewardCount ?? 0),
    sorted.length,
  )
  const loyaltyRewardCups = sorted.slice(0, rewardTake)
  const remaining = sorted.slice(rewardTake)

  if (remaining.length === 1 && args.welcomeK >= 1 && args.igFollowK >= 1) {
    return {
      loyaltyRewardCups,
      welcomeCups: [remaining[0]],
      igFollowCups: [],
    }
  }

  const welcomeTake = Math.min(Math.max(0, args.welcomeK), remaining.length)
  const igTake = Math.min(
    Math.max(0, args.igFollowK),
    Math.max(0, remaining.length - welcomeTake),
  )

  return {
    loyaltyRewardCups,
    welcomeCups: remaining.slice(0, welcomeTake),
    igFollowCups: remaining.slice(welcomeTake, welcomeTake + igTake),
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/Github/mandys_bubble_tea_app-main && npx jest lib/promo-cup-pick.test.ts
```

Expected: PASS — all original + 5 new cases green.

- [ ] **Step 5: Typecheck**

```bash
cd ~/Github/mandys_bubble_tea_app-main && npx tsc --noEmit
```

Expected: 0 errors. Existing `app/checkout.tsx` callsite passes no `loyaltyRewardCount` (defaults to 0), and adds the new `loyaltyRewardCups` field to the destructured result which it ignores — clean.

- [ ] **Step 6: Commit**

```bash
cd ~/Github/mandys_bubble_tea_app-main && git add lib/promo-cup-pick.ts lib/promo-cup-pick.test.ts && git commit -m "feat(promo-cup-pick): add loyaltyRewardCount picker

Mirrors web's new picker semantics: rewards eat cheapest N cups
before welcome/IG. Preserves app's pre-existing cooperative
welcome+IG behavior in the remainder slice."
```

---

### Task 8: App checkout replaces `useReward` boolean with `rewardCount` stepper

**Files:**
- Modify: `<app-worktree>/app/checkout.tsx`

**Why:** UI parity with web.

- [ ] **Step 1: Replace `useReward` state with `rewardCount`**

Find line 102:
```typescript
const [useReward, setUseReward] = useState(false)
```
Replace with:
```typescript
const [rewardCount, setRewardCount] = useState(0)
```

- [ ] **Step 2: Compute `maxRewardCount` near existing loyalty derived values**

Find around lines 131-133:
```typescript
const loyaltyBalance = loyalty?.balance ?? 0
const perReward = starsPerReward || LOYALTY.starsForReward
const canRedeem = perReward > 0 && loyaltyBalance >= perReward
```
Append:
```typescript
const cupCount = items.reduce((n, it) => n + (it.quantity ?? 1), 0)
const maxRewardCount = perReward > 0
  ? Math.min(Math.floor(loyaltyBalance / perReward), cupCount)
  : 0
```
And add a clamp effect:
```typescript
useEffect(() => {
  if (rewardCount > maxRewardCount) setRewardCount(maxRewardCount)
}, [maxRewardCount, rewardCount])
```

- [ ] **Step 3: Replace `cheapestItemPrice` usage with sorted-cheapest-N sum**

Find line 51:
```typescript
function cheapestItemPrice(items: { price: number }[]): number {
  if (items.length === 0) return 0
  return items.reduce((min, it) => (it.price < min ? it.price : min), items[0].price)
}
```
Delete the function. Add a helper near the top of the file:
```typescript
function sumOfCheapestN(items: { price: number; quantity?: number }[], n: number): number {
  if (n <= 0 || items.length === 0) return 0
  const cups: number[] = []
  for (const it of items) {
    const q = it.quantity ?? 1
    for (let i = 0; i < q; i++) cups.push(it.price)
  }
  cups.sort((a, b) => a - b)
  return cups.slice(0, n).reduce((s, p) => s + p, 0)
}
```

Find line 206:
```typescript
const rewardDiscountCents = useReward && canRedeem ? cheapestItemPrice(items) : 0
```
Replace with:
```typescript
const rewardDiscountCents = sumOfCheapestN(items, rewardCount)
```

- [ ] **Step 4: Update `isFreeRedeem` and total math**

Find around line 208:
```typescript
const isFreeRedeem = useReward && canRedeem && total - rewardDiscountCents <= 0
```
Replace with:
```typescript
const isFreeRedeem = rewardCount > 0 && total - rewardDiscountCents - (welcomeDiscountCents ?? 0) - (igFollowDiscountCents ?? 0) <= 0
```
(Use whatever app-side variable names actually correspond to welcome / IG discount cents — open the file and adapt to local names. The intent: `isFreeRedeem` true when the post-discount total is ≤ 0.)

Find around line 222 (the displayTotal / payable calculation that subtracts `rewardDiscountCents`). It already uses `rewardDiscountCents`, which is now the multi-cup sum — no further change needed beyond making sure it's still subtracted.

- [ ] **Step 5: Pass `loyaltyRewardCount` into pickPromoCups**

Find around line 175:
```typescript
const { welcomeCups, igFollowCups } = pickPromoCups({
  ...
})
```
Add `loyaltyRewardCount: rewardCount,` to the args.

- [ ] **Step 6: Send `loyaltyRewardCount` in createOrder body**

Find around line 260:
```typescript
applyWelcomeDiscount: useWelcome,
applyIgFollowDiscount: ...,
applyLoyaltyReward: isFreeRedeem,
```
Update to:
```typescript
applyWelcomeDiscount: useWelcome,
applyIgFollowDiscount: ...,
applyLoyaltyReward: rewardCount > 0,
loyaltyRewardCount: rewardCount,
```

Then update `useCreateOrder` interface in `hooks/use-create-order.ts`:
```typescript
interface CreateOrderParams {
  items: CartItem[]
  applyWelcomeDiscount?: boolean
  applyIgFollowDiscount?: boolean
  applyLoyaltyReward?: boolean
  loyaltyRewardCount?: number   // NEW
  note?: string
}
```
Destructure and forward in the body POST:
```typescript
body: JSON.stringify({
  lines,
  applyWelcomeDiscount: !!applyWelcomeDiscount,
  applyIgFollowDiscount: !!applyIgFollowDiscount,
  applyLoyaltyReward: !!applyLoyaltyReward,
  loyaltyRewardCount: loyaltyRewardCount ?? 0,
  note: note?.trim() ? note.trim() : undefined,
}),
```

- [ ] **Step 7: Send `count` to /api/loyalty/redeem**

Find around line 274 in `app/checkout.tsx`:
```typescript
}>('/api/loyalty/redeem', {
```
Locate the body — it currently sends `{ orderId }`. Add `count: rewardCount`:
```typescript
body: JSON.stringify({ orderId, count: rewardCount }),
```
Also gate the redeem call on `if (rewardCount > 0)` instead of `if (useReward)`.

The response now includes `loyaltyRewardIds: string[]` (as well as legacy `loyaltyRewardId`). If the existing code reads `loyaltyRewardId` and only uses it for logging, leave as-is — back-compat field is provided by server.

- [ ] **Step 8: Replace toggle UI with stepper**

Find the existing "Use a reward" Pressable / Switch row. Replace with:

```tsx
{loyaltyBalance >= perReward && maxRewardCount > 0 && (
  <View style={styles.rewardStepperRow}>
    <View style={{ flex: 1 }}>
      <Text style={styles.rewardStepperLabel}>Use rewards</Text>
      {rewardCount > 0 && (
        <Text style={styles.rewardStepperHint}>
          −${(rewardDiscountCents / 100).toFixed(2)} off {rewardCount} cheapest drink{rewardCount > 1 ? 's' : ''}
        </Text>
      )}
    </View>
    <View style={styles.rewardStepperControls}>
      <Pressable
        onPress={() => setRewardCount((n) => Math.max(0, n - 1))}
        disabled={rewardCount === 0}
        style={[styles.rewardStepperBtn, rewardCount === 0 && styles.rewardStepperBtnDisabled]}
        accessibilityLabel="Decrease reward count"
      >
        <Text style={styles.rewardStepperBtnText}>−</Text>
      </Pressable>
      <Text style={styles.rewardStepperCount}>{rewardCount}</Text>
      <Pressable
        onPress={() => setRewardCount((n) => Math.min(maxRewardCount, n + 1))}
        disabled={rewardCount === maxRewardCount}
        style={[styles.rewardStepperBtn, rewardCount === maxRewardCount && styles.rewardStepperBtnDisabled]}
        accessibilityLabel="Increase reward count"
      >
        <Text style={styles.rewardStepperBtnText}>+</Text>
      </Pressable>
    </View>
  </View>
)}
```

Add styles at the bottom of the StyleSheet block:
```typescript
rewardStepperRow: {
  flexDirection: 'row',
  alignItems: 'center',
  paddingVertical: 12,
  paddingHorizontal: 16,
  borderRadius: 8,
  borderWidth: 1,
  borderColor: 'rgba(196, 58, 16, 0.3)',
  backgroundColor: 'rgba(245, 230, 200, 0.4)',
},
rewardStepperLabel: { fontSize: 14, fontWeight: '500', color: '#C43A10' },
rewardStepperHint: { marginTop: 2, fontSize: 12, color: '#525252' },
rewardStepperControls: { flexDirection: 'row', alignItems: 'center', gap: 12 },
rewardStepperBtn: {
  width: 32, height: 32, borderRadius: 16,
  borderWidth: 1, borderColor: '#C43A10',
  alignItems: 'center', justifyContent: 'center',
},
rewardStepperBtnDisabled: { opacity: 0.3 },
rewardStepperBtnText: { color: '#C43A10', fontSize: 18, fontWeight: '500' },
rewardStepperCount: { minWidth: 24, textAlign: 'center', fontWeight: '500', color: '#C43A10' },
```

- [ ] **Step 9: Update order summary line**

Find around line 787:
```tsx
{rewardDiscount > 0 && (
```
The label inside this row should become `Loyalty reward {rewardCount > 1 ? \`×${rewardCount}\` : ''}`.

- [ ] **Step 10: Typecheck + jest**

```bash
cd ~/Github/mandys_bubble_tea_app-main && npx tsc --noEmit && npx jest
```

Expected: 0 errors, all tests pass.

- [ ] **Step 11: Commit**

```bash
cd ~/Github/mandys_bubble_tea_app-main && git add app/checkout.tsx hooks/use-create-order.ts lib/promo-cup-pick.ts && git commit -m "feat(checkout): multi-cup loyalty reward stepper (app)

Mirrors web: replace useReward boolean with 0..N stepper bounded by
min(floor(stars/9), cupCount). sumOfCheapestN sums the cheapest N cup
prices. createOrder body sends loyaltyRewardCount; /api/loyalty/redeem
sends count. Welcome / IG follow leftover cups via pickPromoCups."
```

---

### Task 9: App full verification + push

- [ ] **Step 1: Full jest + typecheck**

```bash
cd ~/Github/mandys_bubble_tea_app-main && npx jest && npx tsc --noEmit
```

Expected: all green.

- [ ] **Step 2: Manual e2e on simulator (or TestFlight after push)**

```bash
cd ~/Github/mandys_bubble_tea_app-main && npx expo start
```

Sign in with a sandbox account that has 18+ stars (or seed via Square Dashboard). Add 3 drinks → checkout → exercise stepper:
- max=2 visible (capped by cup count in 18-star case)
- click `+` → discount line shows, total updates, Apple Pay sheet sub-amount matches
- click to max → `+` disabled
- click `−` to 0 → discount line vanishes
- place order → check Square Dashboard order shows N Discount lines

- [ ] **Step 3: Push origin**

```bash
cd ~/Github/mandys_bubble_tea_app-main && git push origin main
```

(If on a release branch, push to that branch and merge to main per project's branching convention.)

- [ ] **Step 4: Update DEV_QUEUE.md + add iOS build/release task as separate QUEUE entry**

App release ships via Xcode Archive → TestFlight. Add a follow-up task in `~/system/DEV_QUEUE.md` under the App section: "1.1.4 (build 22) Xcode Archive + TestFlight ship multi-reward". This is out of scope for this plan.

---

## Self-Review

Spec coverage check (against `docs/superpowers/specs/2026-05-07-multi-loyalty-reward-redeem-design.md`):

- §Shared business rules → Tasks 1, 7 (pickPromoCups arg), Tasks 4, 8 (maxRewardCount + sortedUnitPrices)
- §Server contract → Task 3 (redeem route)
- §Web checkout → Task 4
- §App checkout → Task 8
- §Shared lib changes → Tasks 1, 7
- §Failure handling → Task 3 (rollback) + Tasks 4, 8 (client gates redeem on success)
- §Tests (unit) → Tasks 1, 3, 7
- §Tests (integration) → covered by full vitest/jest runs in verification tasks; no separate task since the existing `surcharge.test.ts` files test pure helpers (cardSurcharge / platformFee), not checkout-level reward math
- §Tests (manual e2e) → Tasks 4 Step 12, Task 8 Step 2
- §`/api/orders` server-side change → Task 2 (this is mentioned in spec §"Shared lib changes" by implication; explicit task added because `pickPromoCups` callsite there can't be left stale)

Type consistency:
- `loyaltyRewardCount` (number) used consistently across web/app pickPromoCups args, /api/orders body, /api/loyalty/redeem body (as `count`).
- `loyaltyRewardCups` (return field) used in spec but only consumed by checkout summary if needed; tasks reference it in test assertions only — checkout uses `rewardDiscount = sortedUnitPrices.slice(0, rewardCount).reduce(...)` directly, not `result.loyaltyRewardCups`. This is fine — the field is informational for callers that want it.
- `rewardCount` (state name) consistent in web Task 4 + app Task 8.
- `count` (server body field name) consistent in Task 3 + Task 4 client + Task 8 client.

Placeholder scan: every step has concrete code or commands. No "TBD" / "similar to" / "implement later". App Task 8 Step 4 has one adaptive instruction ("Use whatever app-side variable names actually correspond to welcome / IG discount cents") — this is intentional because the app's local naming may have shifted; the engineer must read the file and adapt. Acceptable because the intent is clearly stated.

Plan is ready.

---

## Out of Scope

- Pre-existing divergence between web's mutually-exclusive welcome/IG and app's cooperative welcome/IG. Documented in Task 7's `pickPromoCups` doc-comment. Worth a separate plan if owner wants parity.
- Square Loyalty program reconfiguration (always 9 stars / 1 free drink).
- Hybrid "partial cash + partial reward" UX.
- Reward redemption analytics on admin dashboard (could add later: histogram of N-reward orders).
- Email/notification when user redeems multiple rewards (no precedent for single-reward redemption notification either).
