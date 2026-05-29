# Loyalty In-Store Accrual Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-backfill loyalty stars for paid orders that have a customer attached but never accrued (the ~10% in-store leak), idempotently and without ever double-accruing.

**Architecture:** One idempotent core function `backfillAccrualForOrder(orderId, source)` drives three triggers — a QStash-delayed webhook job (primary), a 15-min cron sweep (safety net), and a one-time 30-day retro script. Four idempotency layers (Supabase ledger claim, Square accrual precheck, stable idempotency key, time gate) prevent duplicate stars.

**Tech Stack:** Next.js (App Router) + Square SDK v44 + Supabase (service role) + Upstash QStash + Vitest.

**Spec:** `docs/superpowers/specs/2026-05-29-loyalty-accrual-backfill-design.md`

---

## File Structure

- Create `src/lib/loyalty-backfill-log.ts` — Supabase ledger helpers (claim/release/record).
- Create `src/lib/loyalty-backfill.ts` — core `backfillAccrualForOrder` + local paid-check.
- Create `src/lib/loyalty-backfill.test.ts` — unit tests for the core function.
- Modify `src/lib/loyalty.ts` — add optional `idempotencyKey` param to `accrueForOrder`.
- Create `src/app/api/loyalty/backfill-worker/route.ts` — QStash worker.
- Modify `src/app/api/webhooks/square/route.ts` — enqueue delayed backfill in `handleOrderPaid`.
- Create `src/app/api/cron/loyalty-backfill-sweep/route.ts` — cron sweep.
- Modify `vercel.json` — add the cron entry.
- Create `scripts/backfill-loyalty-30d.mjs` — one-time retro (dry-run default).
- Migration: `loyalty_backfill_log` table in prod Supabase.

---

## Task 1: Create the `loyalty_backfill_log` table

**Files:**
- Migration (apply to prod Supabase via `mcp__supabase__apply_migration`, name `loyalty_backfill_log`)

- [ ] **Step 1: Apply the migration**

```sql
create table if not exists public.loyalty_backfill_log (
  square_order_id text primary key,
  loyalty_account_id text,
  points int,
  source text not null check (source in ('webhook','cron','retro')),
  created_at timestamptz not null default now()
);
-- service role only; no RLS policies needed (accessed via service-role key)
alter table public.loyalty_backfill_log enable row level security;
```

- [ ] **Step 2: Verify the table exists**

Run (via `mcp__supabase__list_tables` or SQL editor):
```sql
select count(*) from public.loyalty_backfill_log;
```
Expected: returns `0` (table exists, empty).

- [ ] **Step 3: Commit a record of the migration**

```bash
mkdir -p supabase/migrations
cat > supabase/migrations/$(date -u +%Y%m%d%H%M%S)_loyalty_backfill_log.sql <<'SQL'
create table if not exists public.loyalty_backfill_log (
  square_order_id text primary key,
  loyalty_account_id text,
  points int,
  source text not null check (source in ('webhook','cron','retro')),
  created_at timestamptz not null default now()
);
alter table public.loyalty_backfill_log enable row level security;
SQL
git add supabase/migrations/*_loyalty_backfill_log.sql
git commit -m "feat(loyalty): add loyalty_backfill_log table"
```

---

## Task 2: Ledger helpers — `src/lib/loyalty-backfill-log.ts`

**Files:**
- Create: `src/lib/loyalty-backfill-log.ts`

- [ ] **Step 1: Write the module**

```typescript
import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export type BackfillSource = "webhook" | "cron" | "retro";

/**
 * Atomically claim the right to backfill this order. Inserts a ledger
 * row; the PRIMARY KEY on square_order_id means a concurrent claim (or
 * a prior backfill) surfaces as Postgres 23505 → returns false so the
 * caller skips. Same pattern as claimOrderPushSlot.
 */
export async function claimBackfillSlot(
  orderId: string,
  source: BackfillSource,
): Promise<boolean> {
  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from("loyalty_backfill_log")
    .insert({ square_order_id: orderId, source });
  if (error) {
    if (error.code === "23505") return false;
    throw new Error(`claimBackfillSlot: ${error.message}`);
  }
  return true;
}

/**
 * Release a previously-claimed slot. Called when we decide NOT to
 * accrue after claiming (Square already accrued, no phone) or when the
 * accrual throws — so the order stays eligible for a later retry.
 */
export async function releaseBackfillSlot(orderId: string): Promise<void> {
  const admin = getSupabaseAdmin();
  await admin
    .from("loyalty_backfill_log")
    .delete()
    .eq("square_order_id", orderId);
}

/** Record the account that received the backfilled star (audit). */
export async function recordBackfillResult(
  orderId: string,
  loyaltyAccountId: string,
): Promise<void> {
  const admin = getSupabaseAdmin();
  await admin
    .from("loyalty_backfill_log")
    .update({ loyalty_account_id: loyaltyAccountId })
    .eq("square_order_id", orderId);
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors in `src/lib/loyalty-backfill-log.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/loyalty-backfill-log.ts
git commit -m "feat(loyalty): backfill ledger helpers (claim/release/record)"
```

---

## Task 3: Add optional idempotency key to `accrueForOrder`

**Files:**
- Modify: `src/lib/loyalty.ts` (the `accrueForOrder` function, ~line 276)

- [ ] **Step 1: Write the failing test**

Create `src/lib/loyalty.accrue.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAccumulate = vi.fn();

vi.mock("@/lib/square", () => ({
  SQUARE_LOCATION_ID: "loc_test",
  squareClient: {
    loyalty: { accounts: { accumulatePoints: (...a: unknown[]) => mockAccumulate(...a) } },
  },
  findCustomerByPhone: vi.fn(),
}));

import { accrueForOrder } from "./loyalty";

describe("accrueForOrder idempotency key", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the supplied idempotency key when given", async () => {
    mockAccumulate.mockResolvedValue({});
    await accrueForOrder("acc1", "ord1", "backfill:ord1");
    expect(mockAccumulate).toHaveBeenCalledWith({
      accountId: "acc1",
      idempotencyKey: "backfill:ord1",
      locationId: "loc_test",
      accumulatePoints: { orderId: "ord1" },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/loyalty.accrue.test.ts`
Expected: FAIL — current `accrueForOrder` ignores a 3rd arg and uses `randomUUID()`.

- [ ] **Step 3: Modify `accrueForOrder`**

Replace the function body in `src/lib/loyalty.ts`:
```typescript
export async function accrueForOrder(
  accountId: string,
  orderId: string,
  idempotencyKey?: string,
): Promise<void> {
  if (!SQUARE_LOCATION_ID) {
    throw new Error("SQUARE_LOCATION_ID is not set");
  }

  await squareClient.loyalty.accounts.accumulatePoints({
    accountId,
    idempotencyKey: idempotencyKey ?? randomUUID(),
    locationId: SQUARE_LOCATION_ID,
    accumulatePoints: {
      orderId,
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/loyalty.accrue.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/loyalty.ts src/lib/loyalty.accrue.test.ts
git commit -m "feat(loyalty): accrueForOrder accepts optional idempotency key"
```

---

## Task 4: Core `backfillAccrualForOrder` — `src/lib/loyalty-backfill.ts`

**Files:**
- Create: `src/lib/loyalty-backfill.ts`
- Test: `src/lib/loyalty-backfill.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/loyalty-backfill.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockOrdersGet = vi.fn();
const mockCustomersGet = vi.fn();
const mockSearchEvents = vi.fn();
const mockFindOrCreate = vi.fn();
const mockAccrue = vi.fn();
const mockClaim = vi.fn();
const mockRelease = vi.fn();
const mockRecord = vi.fn();

vi.mock("@/lib/square", () => ({
  SQUARE_LOCATION_ID: "loc_test",
  squareClient: {
    orders: { get: (...a: unknown[]) => mockOrdersGet(...a) },
    customers: { get: (...a: unknown[]) => mockCustomersGet(...a) },
    loyalty: { searchEvents: (...a: unknown[]) => mockSearchEvents(...a) },
  },
}));
vi.mock("@/lib/loyalty", () => ({
  findOrCreateLoyaltyAccount: (...a: unknown[]) => mockFindOrCreate(...a),
  accrueForOrder: (...a: unknown[]) => mockAccrue(...a),
}));
vi.mock("@/lib/loyalty-backfill-log", () => ({
  claimBackfillSlot: (...a: unknown[]) => mockClaim(...a),
  releaseBackfillSlot: (...a: unknown[]) => mockRelease(...a),
  recordBackfillResult: (...a: unknown[]) => mockRecord(...a),
}));

import { backfillAccrualForOrder } from "./loyalty-backfill";

const paidOrder = (over = {}) => ({
  order: {
    id: "ord1",
    state: "COMPLETED",
    customerId: "cust1",
    totalMoney: { amount: 700n },
    tenders: [{ type: "CARD", cardDetails: { status: "CAPTURED" } }],
    ...over,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  mockClaim.mockResolvedValue(true);
  mockSearchEvents.mockResolvedValue({ events: [] });
  mockCustomersGet.mockResolvedValue({ customer: { phoneNumber: "+61400000000" } });
  mockFindOrCreate.mockResolvedValue({ accountId: "acc1", balance: 0, lifetimePoints: 0 });
  mockAccrue.mockResolvedValue(undefined);
});

describe("backfillAccrualForOrder", () => {
  it("accrues for a paid order with customer + no prior accrual", async () => {
    mockOrdersGet.mockResolvedValue(paidOrder());
    const r = await backfillAccrualForOrder("ord1", "cron");
    expect(r.status).toBe("accrued");
    expect(mockAccrue).toHaveBeenCalledWith("acc1", "ord1", "backfill:ord1");
    expect(mockRecord).toHaveBeenCalledWith("ord1", "acc1");
  });

  it("skips an unpaid order", async () => {
    mockOrdersGet.mockResolvedValue(paidOrder({ state: "OPEN", tenders: [] }));
    const r = await backfillAccrualForOrder("ord1", "cron");
    expect(r.status).toBe("skipped");
    expect(r.reason).toBe("not_paid");
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it("skips an order with no customer", async () => {
    mockOrdersGet.mockResolvedValue(paidOrder({ customerId: undefined }));
    const r = await backfillAccrualForOrder("ord1", "cron");
    expect(r.reason).toBe("no_customer");
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it("skips when slot already claimed (idempotency)", async () => {
    mockOrdersGet.mockResolvedValue(paidOrder());
    mockClaim.mockResolvedValue(false);
    const r = await backfillAccrualForOrder("ord1", "cron");
    expect(r.reason).toBe("already_logged");
    expect(mockAccrue).not.toHaveBeenCalled();
  });

  it("releases slot + returns already when Square already accrued", async () => {
    mockOrdersGet.mockResolvedValue(paidOrder());
    mockSearchEvents.mockResolvedValue({ events: [{ id: "ev1" }] });
    const r = await backfillAccrualForOrder("ord1", "cron");
    expect(r.status).toBe("already");
    expect(mockRelease).toHaveBeenCalledWith("ord1");
    expect(mockAccrue).not.toHaveBeenCalled();
  });

  it("enrolls when no account exists then accrues", async () => {
    mockOrdersGet.mockResolvedValue(paidOrder());
    await backfillAccrualForOrder("ord1", "webhook");
    expect(mockFindOrCreate).toHaveBeenCalledWith("cust1", "+61400000000");
    expect(mockAccrue).toHaveBeenCalled();
  });

  it("releases slot + returns no_phone when customer has no phone", async () => {
    mockOrdersGet.mockResolvedValue(paidOrder());
    mockCustomersGet.mockResolvedValue({ customer: { phoneNumber: undefined } });
    const r = await backfillAccrualForOrder("ord1", "cron");
    expect(r.reason).toBe("no_phone");
    expect(mockRelease).toHaveBeenCalledWith("ord1");
  });

  it("releases slot when accrual throws", async () => {
    mockOrdersGet.mockResolvedValue(paidOrder());
    mockAccrue.mockRejectedValue(new Error("square down"));
    const r = await backfillAccrualForOrder("ord1", "cron");
    expect(r.status).toBe("skipped");
    expect(r.reason).toBe("error");
    expect(mockRelease).toHaveBeenCalledWith("ord1");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/loyalty-backfill.test.ts`
Expected: FAIL with "backfillAccrualForOrder is not a function" / module not found.

- [ ] **Step 3: Write the implementation**

Create `src/lib/loyalty-backfill.ts`:
```typescript
import "server-only";
import { squareClient } from "@/lib/square";
import { findOrCreateLoyaltyAccount, accrueForOrder } from "@/lib/loyalty";
import {
  claimBackfillSlot,
  releaseBackfillSlot,
  recordBackfillResult,
  type BackfillSource,
} from "@/lib/loyalty-backfill-log";

export type BackfillResult =
  | { status: "accrued"; accountId: string }
  | { status: "already" }
  | {
      status: "skipped";
      reason: "not_paid" | "no_customer" | "no_phone" | "already_logged" | "error";
      detail?: string;
    };

/**
 * Settled-payment gate. Mirrors the logic in src/lib/print-jobs.ts:
 * COMPLETED orders (incl. $0 redemptions) count; otherwise require a
 * CAPTURED card tender (non-card tenders count as settled). FAILED /
 * VOIDED card tenders do NOT count.
 */
function isOrderSettled(order: {
  state?: string;
  tenders?: Array<{ type?: string; cardDetails?: { status?: string } }>;
}): boolean {
  const isCompleted = order.state === "COMPLETED";
  const hasSettledTender = (order.tenders ?? []).some((t) =>
    t.type === "CARD" ? t.cardDetails?.status === "CAPTURED" : true,
  );
  return isCompleted || hasSettledTender;
}

/**
 * Backfill a loyalty star for an order that has a customer attached but
 * never accrued. Idempotent and safe to call from the webhook, the cron
 * sweep, and the retro script. Never throws — returns a result enum.
 */
export async function backfillAccrualForOrder(
  orderId: string,
  source: BackfillSource,
): Promise<BackfillResult> {
  // 1. Fetch + payment gate
  let order;
  try {
    const resp = await squareClient.orders.get({ orderId });
    order = resp.order;
  } catch (err) {
    return { status: "skipped", reason: "error", detail: String(err) };
  }
  if (!order || !isOrderSettled(order)) {
    return { status: "skipped", reason: "not_paid" };
  }
  const customerId = order.customerId;
  if (!customerId) {
    return { status: "skipped", reason: "no_customer" };
  }

  // 2. L1: claim the slot (concurrency + idempotency guard)
  const claimed = await claimBackfillSlot(orderId, source);
  if (!claimed) {
    return { status: "skipped", reason: "already_logged" };
  }

  try {
    // 3. L2: skip if any accrual already exists for this order
    const ev = await squareClient.loyalty.searchEvents({
      query: {
        filter: {
          orderFilter: { orderId },
          typeFilter: { types: ["ACCUMULATE_POINTS"] },
        },
      },
    });
    if ((ev.events ?? []).length > 0) {
      await releaseBackfillSlot(orderId);
      return { status: "already" };
    }

    // 4. Resolve phone, enroll if needed
    const custResp = await squareClient.customers.get({ customerId });
    const phone = custResp.customer?.phoneNumber;
    if (!phone) {
      await releaseBackfillSlot(orderId);
      return { status: "skipped", reason: "no_phone" };
    }
    const account = await findOrCreateLoyaltyAccount(customerId, phone);

    // 5. L3: accrue with a stable idempotency key
    await accrueForOrder(account.accountId, orderId, `backfill:${orderId}`);
    await recordBackfillResult(orderId, account.accountId);
    return { status: "accrued", accountId: account.accountId };
  } catch (err) {
    await releaseBackfillSlot(orderId);
    return { status: "skipped", reason: "error", detail: String(err) };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/loyalty-backfill.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/lib/loyalty-backfill.ts src/lib/loyalty-backfill.test.ts
git commit -m "feat(loyalty): core idempotent backfillAccrualForOrder + tests"
```

---

## Task 5: QStash worker route — `/api/loyalty/backfill-worker`

**Files:**
- Create: `src/app/api/loyalty/backfill-worker/route.ts`

- [ ] **Step 1: Write the route**

```typescript
import { NextResponse } from "next/server";
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { backfillAccrualForOrder } from "@/lib/loyalty-backfill";

export const dynamic = "force-dynamic";

async function handler(request: Request) {
  let orderId: string | undefined;
  try {
    const body = (await request.json()) as { orderId?: string };
    orderId = body.orderId;
  } catch {
    return NextResponse.json({ ok: false, error: "bad body" }, { status: 400 });
  }
  if (!orderId) {
    return NextResponse.json({ ok: false, error: "missing orderId" }, { status: 400 });
  }

  const result = await backfillAccrualForOrder(orderId, "webhook");
  console.log(`[loyalty-backfill-worker] order=${orderId} ${JSON.stringify(result)}`);
  // Always 2xx for handled outcomes so QStash doesn't retry a clean skip.
  return NextResponse.json({ ok: true, result });
}

export const POST = verifySignatureAppRouter(handler);
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/loyalty/backfill-worker/route.ts
git commit -m "feat(loyalty): QStash worker that backfills a single order"
```

---

## Task 6: Enqueue delayed backfill from the order.updated webhook

**Files:**
- Modify: `src/app/api/webhooks/square/route.ts` (inside `handleOrderPaid`, after the cup-label block)

- [ ] **Step 1: Add the enqueue helper near the other handlers**

Add this function above `handleOrderPaid`:
```typescript
/**
 * Enqueue a delayed loyalty-backfill job for an order that has a
 * customer attached. The ~5 min delay lets Square's own POS check-in
 * accrual settle first, so the worker only backfills genuine misses.
 */
async function enqueueLoyaltyBackfill(orderId: string): Promise<void> {
  const { Client: QStashClient } = await import("@upstash/qstash");
  const { walletEnv } = await import("@/lib/wallet/env");
  const env = walletEnv();
  const qstash = new QStashClient({ token: env.qstashToken, baseUrl: env.qstashUrl });
  const workerUrl = `${env.webServiceUrl.replace(/\/api\/wallet\/?$/, "")}/api/loyalty/backfill-worker`;
  await qstash.publishJSON({
    url: workerUrl,
    body: { orderId },
    delay: "5m",
    retries: 3,
  });
}
```

- [ ] **Step 2: Call it from `handleOrderPaid`**

At the end of `handleOrderPaid`, after the existing cup-label `try/catch` block and before the function returns, add:
```typescript
    // Loyalty safety net: if a customer is attached, schedule a delayed
    // backfill so a missed POS check-in still earns the star.
    if (order.customerId) {
      try {
        await enqueueLoyaltyBackfill(orderId);
        console.log(`[loyalty-backfill] enqueued order ${orderId} event_id=${eventId}`);
      } catch (e) {
        console.error("[loyalty-backfill] enqueue failed (non-fatal)", e);
      }
    }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. (`order` and `orderId` and `eventId` are already in scope inside `handleOrderPaid`.)

- [ ] **Step 4: Commit**

```bash
git add src/app/api/webhooks/square/route.ts
git commit -m "feat(loyalty): enqueue delayed backfill on order.updated"
```

---

## Task 7: Cron sweep route — `/api/cron/loyalty-backfill-sweep`

**Files:**
- Create: `src/app/api/cron/loyalty-backfill-sweep/route.ts`

- [ ] **Step 1: Write the route**

```typescript
import { NextResponse } from "next/server";
import { squareClient, SQUARE_LOCATION_ID } from "@/lib/square";
import { backfillAccrualForOrder } from "@/lib/loyalty-backfill";

export const dynamic = "force-dynamic";

// Window: old enough that Square's own check-in accrual has settled
// (>=10 min), young enough to stay timely (<=60 min). Cron runs every
// 15 min, so the 50-min span overlaps — the ledger dedups re-scans.
const MIN_AGE_MS = 10 * 60 * 1000;
const MAX_AGE_MS = 60 * 60 * 1000;

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = request.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
  }

  const now = Date.now();
  const startAt = new Date(now - MAX_AGE_MS).toISOString();
  const endAt = new Date(now - MIN_AGE_MS).toISOString();

  let processed = 0;
  let accrued = 0;
  let cursor: string | undefined;
  try {
    do {
      const res = await squareClient.orders.search({
        locationIds: [SQUARE_LOCATION_ID],
        query: {
          filter: {
            dateTimeFilter: { createdAt: { startAt, endAt } },
            stateFilter: { states: ["COMPLETED", "OPEN"] },
          },
          sort: { sortField: "CREATED_AT", sortOrder: "DESC" },
        },
        limit: 500,
        cursor,
      });
      const orders = res.orders ?? [];
      for (const o of orders) {
        if (!o.id || !o.customerId) continue;
        processed++;
        const r = await backfillAccrualForOrder(o.id, "cron");
        if (r.status === "accrued") accrued++;
      }
      cursor = res.cursor;
    } while (cursor);
  } catch (e) {
    console.error("[loyalty-backfill-sweep] error", e);
    return NextResponse.json({ ok: false, processed, accrued }, { status: 500 });
  }

  console.log(`[loyalty-backfill-sweep] processed=${processed} accrued=${accrued}`);
  return NextResponse.json({ ok: true, processed, accrued });
}
```

- [ ] **Step 2: Add the cron to `vercel.json`**

Edit `vercel.json` so `crons` reads:
```json
{
  "crons": [
    {
      "path": "/api/cron/heartbeat-check",
      "schedule": "0 3 * * *"
    },
    {
      "path": "/api/cron/loyalty-backfill-sweep",
      "schedule": "*/15 * * * *"
    }
  ]
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cron/loyalty-backfill-sweep/route.ts vercel.json
git commit -m "feat(loyalty): 15-min cron sweep that backfills missed accruals"
```

---

## Task 8: One-time 30-day retro script (dry-run default)

**Files:**
- Create: `scripts/backfill-loyalty-30d.mjs`

- [ ] **Step 1: Write the script**

```javascript
// One-time retro: backfill missed loyalty accruals over the last 30 days.
// Dry-run by default (reports counts + sample). Pass --apply to write.
// Run: set -a; source .env.production; set +a; node scripts/backfill-loyalty-30d.mjs [--apply]

import { SquareClient, SquareEnvironment } from "square";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const DAYS = Number(process.env.DAYS ?? 30);

const sq = new SquareClient({
  token: process.env.SQUARE_ACCESS_TOKEN,
  environment: (process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT ?? "production") === "production"
    ? SquareEnvironment.Production : SquareEnvironment.Sandbox,
});
const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const LOC = process.env.SQUARE_LOCATION_ID;
const since = new Date(Date.now() - DAYS * 24 * 3600 * 1000).toISOString();

const isSettled = (o) =>
  o.state === "COMPLETED" ||
  (o.tenders ?? []).some((t) => (t.type === "CARD" ? t.cardDetails?.status === "CAPTURED" : true));

async function alreadyAccrued(orderId) {
  const ev = await sq.loyalty.searchEvents({
    query: { filter: { orderFilter: { orderId }, typeFilter: { types: ["ACCUMULATE_POINTS"] } } },
  });
  return (ev.events ?? []).length > 0;
}

// 1. collect candidate orders (paid + customer attached)
const candidates = [];
let cursor;
do {
  const res = await sq.orders.search({
    locationIds: [LOC],
    query: {
      filter: { dateTimeFilter: { createdAt: { startAt: since } }, stateFilter: { states: ["COMPLETED", "OPEN"] } },
      sort: { sortField: "CREATED_AT", sortOrder: "DESC" },
    },
    limit: 500,
    cursor,
  });
  for (const o of (res.orders ?? [])) {
    if (o.id && o.customerId && isSettled(o)) candidates.push(o);
  }
  cursor = res.cursor;
} while (cursor);

console.log(`candidates (paid + customer) in ${DAYS}d: ${candidates.length}`);

// 2. find the genuine misses
const misses = [];
for (const o of candidates) {
  if (await alreadyAccrued(o.id)) continue;
  misses.push(o);
}
console.log(`genuine misses (no accrual yet): ${misses.length}`);
for (const o of misses.slice(0, 20)) {
  console.log(`  ${o.createdAt?.slice(0, 16)}  cust=${o.customerId}  order=${o.id}`);
}

if (!APPLY) {
  console.log(`\nDRY RUN. Re-run with --apply to backfill these ${misses.length} orders.`);
  process.exit(0);
}

// 3. apply
let accrued = 0;
for (const o of misses) {
  // claim ledger slot
  const { error: claimErr } = await supa
    .from("loyalty_backfill_log")
    .insert({ square_order_id: o.id, source: "retro" });
  if (claimErr) {
    if (claimErr.code === "23505") continue; // already done
    console.error(`claim failed ${o.id}: ${claimErr.message}`);
    continue;
  }
  try {
    const cust = (await sq.customers.get({ customerId: o.customerId }))?.customer;
    const phone = cust?.phoneNumber;
    if (!phone) { await supa.from("loyalty_backfill_log").delete().eq("square_order_id", o.id); continue; }
    // find-or-create loyalty account by phone
    const found = await sq.loyalty.accounts.search({ query: { mappings: [{ phoneNumber: phone }] }, limit: 1 });
    let accountId = found.loyaltyAccounts?.[0]?.id;
    if (!accountId) {
      const prog = await sq.loyalty.programs.get({ programId: "main" });
      const created = await sq.loyalty.accounts.create({
        idempotencyKey: `retro-enroll:${o.id}`,
        loyaltyAccount: { programId: prog.program.id, customerId: o.customerId, mapping: { phoneNumber: phone } },
      });
      accountId = created.loyaltyAccount?.id;
    }
    await sq.loyalty.accounts.accumulatePoints({
      accountId,
      idempotencyKey: `backfill:${o.id}`,
      locationId: LOC,
      accumulatePoints: { orderId: o.id },
    });
    await supa.from("loyalty_backfill_log").update({ loyalty_account_id: accountId }).eq("square_order_id", o.id);
    accrued++;
  } catch (e) {
    await supa.from("loyalty_backfill_log").delete().eq("square_order_id", o.id);
    console.error(`accrue failed ${o.id}: ${e?.message ?? e}`);
  }
}
console.log(`\nAPPLIED. backfilled ${accrued}/${misses.length} orders.`);
```

- [ ] **Step 2: Dry run + report to Stan**

Run: `set -a; source .env.production; set +a; node scripts/backfill-loyalty-30d.mjs`
Expected: prints candidate count + miss count + sample. **Report the numbers to Stan and get confirmation before applying.**

- [ ] **Step 3: Apply after confirmation**

Run: `set -a; source .env.production; set +a; node scripts/backfill-loyalty-30d.mjs --apply`
Expected: prints `APPLIED. backfilled N/M orders.`

- [ ] **Step 4: Commit the script**

```bash
git add scripts/backfill-loyalty-30d.mjs
git commit -m "feat(loyalty): one-time 30-day accrual backfill script"
```

---

## Task 9: Full suite + final verification

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all pass (incl. the new `loyalty.accrue` + `loyalty-backfill` tests). Note any pre-existing flakes (widget-data date flakes are known).

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: no new errors in touched files.

- [ ] **Step 3: Verify QStash worker env**

Confirm `QSTASH_*` and `WALLET_WEBSERVICE_URL` exist in Vercel prod env (already present — reused from wallet push). Confirm `CRON_SECRET` is set in Vercel prod env (used by the existing heartbeat cron).

- [ ] **Step 4: Post-deploy live check (after Vercel deploy)**

Run the reconciliation diagnostic and confirm the miss-rate drops over the following hours:
`set -a; source .env.production; set +a; HOURS=6 node scripts/.tmp/diag-orders-vs-stars.mjs`
Expected: newly-missed orders get backfilled within ~5 min (webhook) or ≤15 min (cron); `loyalty_backfill_log` accumulates rows with `source` in (`webhook`,`cron`,`retro`).

---

## Self-Review Notes

- **Spec coverage:** trigger condition (Task 4), enroll-if-missing (Task 4 `findOrCreateLoyaltyAccount`), 4 idempotency layers (L1 Task 2/4, L2 Task 4, L3 Task 3/4, L4 Tasks 6/7), webhook (Tasks 5–6), cron (Task 7), retro dry-run-first (Task 8), wallet refresh (free via existing `handleLoyaltyBalanceUpdate` — no task needed), known blind spot (documented in spec). ✓
- **Types:** `BackfillSource` (Task 2) reused in Tasks 4/5/7/8; `BackfillResult` (Task 4) returned by worker (Task 5) and cron (Task 7); `accrueForOrder(accountId, orderId, idempotencyKey?)` (Task 3) called as `accrueForOrder(account.accountId, orderId, "backfill:"+orderId)` (Task 4). Consistent. ✓
- **No placeholders:** all steps contain runnable code/commands. ✓
