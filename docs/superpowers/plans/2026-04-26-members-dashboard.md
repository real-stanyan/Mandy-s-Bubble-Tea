# Members Dashboard Implementation Plan — SUPERSEDED 2026-04-26 PM

> **STATUS: SUPERSEDED.** Owner decided the dashboard ships as a standalone deployment in a new repo `mandys_bubble_tea_admin/`. Use `2026-04-26-members-dashboard-standalone.md` instead. This file kept for reference only.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/admin/members` — an admin-only page showing total members, web vs app split, weekly/monthly growth, registered → first-order funnel, and loyalty completion stats. Source spec: `docs/superpowers/specs/2026-04-26-members-dashboard-design.md`.

**Architecture:** Next.js server component for the page shell + client component for Recharts charts. New `/api/admin/members-stats` route returns one JSON payload aggregating Supabase + Square data. New `user_profiles.signup_channel` column (with one-time push-token-based backfill) provides the web/app axis. Reuses existing `src/app/admin/layout.tsx` for auth.

**Tech Stack:** Next.js 14 App Router · TypeScript · Supabase (Postgres + auth) · Square SDK (Customers, Loyalty, Orders) · Recharts · Vitest · Tailwind.

---

## File Map

**Create:**
- `supabase/migrations/2026-04-26-signup-channel.sql` — column + backfill
- `src/lib/members-stats.ts` — server-only aggregation (one exported `getMembersStats()`)
- `src/lib/members-stats.test.ts` — vitest unit tests
- `src/app/api/admin/members-stats/route.ts` — JSON endpoint wrapping the lib
- `src/app/admin/members/page.tsx` — server component, fetches data
- `src/app/admin/members/MembersDashboard.tsx` — client component with charts
- `src/components/admin/KpiTile.tsx` — reusable presentational tile
- `src/components/admin/MembersTrendChart.tsx` — Recharts line chart (90d)
- `src/components/admin/ChannelDonut.tsx` — Recharts donut (web/app/unknown)
- `src/components/admin/FunnelBars.tsx` — Recharts horizontal bar (registered → ordered → repeat)
- `src/components/admin/TopCustomersTable.tsx` — top-10 plain table
- `docs/superpowers/runbooks/members-dashboard-rollout.md` — manual steps for prod (admin_users seed, RN app coordination)

**Modify:**
- `package.json` — add `recharts` dep
- `src/app/api/auth/complete-signup/route.ts` — accept `channel` in body, persist
- `src/components/auth/AuthProvider.tsx` — `completeSignup()` always sends `channel: 'web'`

**Untouched but referenced:**
- `src/app/admin/layout.tsx` — provides auth gate; do not modify
- `src/lib/auth.ts:62-77` — `toAuthedUser()` selects `user_profiles` columns; new column does not need to be added here (admin lib reads it directly)

---

## Task 1: Add Recharts dependency

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install recharts**

Run from repo root:

```bash
npm install recharts@^2.12.0
```

Expected: success, `package.json` gains `"recharts": "^2.12.0"` under `dependencies`.

- [ ] **Step 2: Verify it installs cleanly**

```bash
npm run typecheck
```

Expected: PASS, no errors.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add recharts for admin dashboards"
```

---

## Task 2: Migration — add `signup_channel` column with push-token backfill

**Files:**
- Create: `supabase/migrations/2026-04-26-signup-channel.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/2026-04-26-signup-channel.sql`:

```sql
-- 2026-04-26: signup_channel column on user_profiles.
--
-- Distinguishes web-registered vs app-registered members for the
-- /admin/members dashboard. Backfilled from device_push_tokens because
-- the column did not exist when these users registered:
--   any push token  → 'app' (must have opened the RN app at least once)
--   no push token   → 'web' (best-effort default)
--
-- New rows MUST set this column from the client (web → 'web',
-- app → 'app'). Until the RN release ships, app-originated signups
-- arrive with NULL; the dashboard surfaces these as "Unknown".
-- Phase 2 migration adds NOT NULL after RN release ships.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS signup_channel TEXT;

ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_signup_channel_check;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_signup_channel_check
  CHECK (signup_channel IS NULL OR signup_channel IN ('web', 'app'));

-- Idempotent backfill — only touches rows that haven't been classified.
UPDATE public.user_profiles up
SET signup_channel = CASE
  WHEN EXISTS (
    SELECT 1
    FROM public.device_push_tokens dpt
    WHERE dpt.user_id = up.user_id
  ) THEN 'app'
  ELSE 'web'
END
WHERE signup_channel IS NULL;
```

- [ ] **Step 2: Apply locally to verify SQL is valid**

If the project has a local Supabase running:

```bash
supabase db reset --linked=false
```

If not (likely the case — this project ships migrations to prod via Supabase Studio per spec § Rollout), instead lint the SQL by eye and check that:
- `ADD COLUMN IF NOT EXISTS` is used (re-runnable)
- `DROP CONSTRAINT IF EXISTS` precedes `ADD CONSTRAINT` (re-runnable)
- `WHERE signup_channel IS NULL` makes the UPDATE idempotent

No automated test for the SQL itself — it ships to prod via Supabase Studio.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/2026-04-26-signup-channel.sql
git commit -m "db: add user_profiles.signup_channel with push-token backfill"
```

---

## Task 3: `complete-signup` route accepts and persists `channel`

**Files:**
- Modify: `src/app/api/auth/complete-signup/route.ts`

- [ ] **Step 1: Update the body type and parsing**

In `src/app/api/auth/complete-signup/route.ts`, change the `Body` type and the parsing block (around lines 28-67):

```typescript
type Body = {
  firstName?: unknown;
  lastName?: unknown;
  channel?: unknown;
};
```

Then after the existing `firstName` / `lastName` validation, add:

```typescript
  const channelRaw = typeof body.channel === "string" ? body.channel : "";
  const channel: "web" | "app" | null =
    channelRaw === "web" || channelRaw === "app" ? channelRaw : null;
  // channel is optional — older clients (and the RN app pre-release)
  // do not send it. NULL is allowed in DB until the Phase 2 migration.
```

- [ ] **Step 2: Persist channel on the upsert**

In the same file, the upsert call (around lines 139-156). Add `signup_channel` to the values:

```typescript
    const { data: upserted, error: upsertErr } = await admin
      .from("user_profiles")
      .upsert(
        {
          user_id: user.userId,
          square_customer_id: customerId,
          phone_e164: e164,
          first_name: firstName,
          last_name: lastName || null,
          square_verified_at: new Date().toISOString(),
          signup_channel: channel,
        },
        { onConflict: "user_id" },
      )
      .select(
        "user_id, square_customer_id, phone_e164, first_name, last_name, square_verified_at, signup_channel",
      )
      .single();
    if (upsertErr) throw upsertErr;
```

Important: this upsert path runs only the FIRST time a profile is created (existing-profile path returns early at line 84). So `signup_channel` is set once and never overwritten — calling `complete-signup` later (e.g. profile edits) won't accidentally flip channel.

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/auth/complete-signup/route.ts
git commit -m "feat(auth): persist signup_channel in user_profiles"
```

---

## Task 4: Web client always sends `channel: 'web'`

**Files:**
- Modify: `src/components/auth/AuthProvider.tsx`

- [ ] **Step 1: Update `completeSignup` request body**

In `src/components/auth/AuthProvider.tsx`, the `completeSignup` callback (around lines 298-313). Change the `body` to include `channel: 'web'`:

```typescript
  const completeSignup = useCallback(
    async ({
      firstName,
      lastName,
    }: {
      firstName: string;
      lastName?: string;
    }) => {
      const res = await fetch("/api/auth/complete-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, channel: "web" }),
      });
```

(Only the `body` line changes. Rest of the function stays as-is.)

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Manually verify in dev**

Per `feedback_mandys_dev_server.md` user memory: always run dev server before claiming UI work done.

```bash
npm run dev
```

In another terminal:

```bash
# Hit the route with a forged unauth request — must 401, NOT 400.
# This proves the new optional field doesn't break the route.
curl -sX POST http://localhost:3000/api/auth/complete-signup \
  -H 'Content-Type: application/json' \
  -d '{"firstName":"Test","channel":"web"}'
```

Expected: `{"ok":false,"error":"Not signed in"}` with 401.

- [ ] **Step 4: Commit**

```bash
git add src/components/auth/AuthProvider.tsx
git commit -m "feat(auth): web client tags new registrations as channel=web"
```

---

## Task 5: Members stats lib — types and Supabase-only KPIs

**Files:**
- Create: `src/lib/members-stats.ts`
- Create: `src/lib/members-stats.test.ts`

This task implements the Supabase half: total / web / app / unknown counts, and weekly/monthly new with prior-period delta. Square-dependent fields come in Task 6.

- [ ] **Step 1: Define types and skeleton**

Create `src/lib/members-stats.ts`:

```typescript
import "server-only";
import { getSupabaseAdmin } from "./supabase-server";

export type Channel = "web" | "app" | "unknown";

export type MembersStats = {
  generatedAt: string;
  kpis: {
    totalMembers: number;
    web: { count: number; pct: number };
    app: { count: number; pct: number };
    unknown: { count: number; pct: number };
    newThisMonth: { count: number; previous: number; deltaPct: number | null };
    newThisWeek: { count: number; previous: number; deltaPct: number | null };
    ordered: { count: number; total: number; conversionPct: number };
    loyalty: { withReward: number; balanceGte9: number };
    rewardsRedeemedThisMonth: number;
  };
  trend: { date: string; web: number; app: number; unknown: number }[];
  channelDistribution: { channel: Channel; count: number }[];
  funnel: { registered: number; ordered: number; repeat: number };
  topCustomers: TopCustomer[];
};

export type TopCustomer = {
  customerId: string;
  name: string;
  phoneMasked: string;
  channel: Channel;
  totalOrders: number;
  lifetimeSpendCents: number;
  lastOrderAt: string | null;
};

// Brisbane is the store TZ. Use plain UTC offset because BNE has no DST.
const BRISBANE_OFFSET_MIN = 10 * 60;

function brisbaneNow(): Date {
  const utc = Date.now();
  return new Date(utc + BRISBANE_OFFSET_MIN * 60 * 1000);
}

function startOfBrisbaneMonth(d: Date): Date {
  // d is already shifted to BNE wall-clock; build UTC-tagged ISO from it.
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, -10, 0, 0));
}

function startOfBrisbaneWeek(d: Date): Date {
  // Week starts Monday. d is BNE wall-clock.
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (dow + 6) % 7;
  const monday = new Date(Date.UTC(
    d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysSinceMonday,
    -10, 0, 0,
  ));
  return monday;
}

function pct(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10; // 1 decimal
}

function deltaPct(curr: number, prev: number): number | null {
  if (prev === 0) return curr === 0 ? 0 : null; // can't compute % on /0
  return Math.round(((curr - prev) / prev) * 1000) / 10;
}

export async function getMembersStats(): Promise<MembersStats> {
  const now = brisbaneNow();
  const monthStart = startOfBrisbaneMonth(now);
  const prevMonthStart = startOfBrisbaneMonth(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15, -10, 0, 0)),
  );
  const weekStart = startOfBrisbaneWeek(now);
  const prevWeekStart = new Date(weekStart.getTime() - 7 * 24 * 3600 * 1000);

  const counts = await fetchChannelCounts();
  const newThisMonth = await fetchNewMembers(monthStart, now);
  const newPrevMonth = await fetchNewMembers(prevMonthStart, monthStart);
  const newThisWeek = await fetchNewMembers(weekStart, now);
  const newPrevWeek = await fetchNewMembers(prevWeekStart, weekStart);
  const trend = await fetchTrend(90);

  return {
    generatedAt: new Date().toISOString(),
    kpis: {
      totalMembers: counts.total,
      web: { count: counts.web, pct: pct(counts.web, counts.total) },
      app: { count: counts.app, pct: pct(counts.app, counts.total) },
      unknown: { count: counts.unknown, pct: pct(counts.unknown, counts.total) },
      newThisMonth: {
        count: newThisMonth,
        previous: newPrevMonth,
        deltaPct: deltaPct(newThisMonth, newPrevMonth),
      },
      newThisWeek: {
        count: newThisWeek,
        previous: newPrevWeek,
        deltaPct: deltaPct(newThisWeek, newPrevWeek),
      },
      // Square-dependent fields fill in Task 6
      ordered: { count: 0, total: counts.total, conversionPct: 0 },
      loyalty: { withReward: 0, balanceGte9: 0 },
      rewardsRedeemedThisMonth: 0,
    },
    trend,
    channelDistribution: [
      { channel: "web", count: counts.web },
      { channel: "app", count: counts.app },
      { channel: "unknown", count: counts.unknown },
    ],
    funnel: { registered: counts.total, ordered: 0, repeat: 0 },
    topCustomers: [], // Task 6
  };
}

async function fetchChannelCounts(): Promise<{
  total: number;
  web: number;
  app: number;
  unknown: number;
}> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("user_profiles")
    .select("signup_channel");
  if (error) throw new Error(`fetchChannelCounts: ${error.message}`);
  const rows = (data ?? []) as { signup_channel: string | null }[];
  let web = 0, app = 0, unknown = 0;
  for (const r of rows) {
    if (r.signup_channel === "web") web++;
    else if (r.signup_channel === "app") app++;
    else unknown++;
  }
  return { total: rows.length, web, app, unknown };
}

async function fetchNewMembers(start: Date, end: Date): Promise<number> {
  const admin = getSupabaseAdmin();
  // user_profiles is created during complete-signup so its row's
  // implicit created_at would work, but auth.users.created_at is the
  // canonical "registered at" timestamp. Use the auth schema.
  const { data, error } = await admin
    .schema("auth")
    .from("users")
    .select("id", { count: "exact", head: true })
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString());
  if (error) throw new Error(`fetchNewMembers: ${error.message}`);
  // count is on the response when head: true
  return (data as unknown as { count?: number })?.count ?? 0;
}

async function fetchTrend(
  days: number,
): Promise<{ date: string; web: number; app: number; unknown: number }[]> {
  const admin = getSupabaseAdmin();
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

  // Pull joined rows: auth.users.created_at + user_profiles.signup_channel.
  // Both tables small enough (<10k rows expected) that an in-memory bucket is fine.
  // Pull profiles + their channels (channel lives on user_profiles, not auth.users).
  // Then pull auth.users created_at separately and join in memory.
  // Both queries are bounded by table size (<10k expected), so an in-memory
  // join is fine. Switch to a Postgres view/RPC if this becomes hot.
  const { data, error } = await admin
    .from("user_profiles")
    .select("user_id, signup_channel");
  if (error) throw new Error(`fetchTrend (profiles): ${error.message}`);

  const profiles = (data ?? []) as { user_id: string; signup_channel: string | null }[];
  const channelById = new Map(profiles.map((p) => [p.user_id, p.signup_channel]));

  const { data: users, error: uErr } = await admin
    .schema("auth")
    .from("users")
    .select("id, created_at")
    .gte("created_at", since);
  if (uErr) throw new Error(`fetchTrend (users): ${uErr.message}`);

  const buckets = new Map<string, { web: number; app: number; unknown: number }>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 3600 * 1000);
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, { web: 0, app: 0, unknown: 0 });
  }

  for (const u of (users as { id: string; created_at: string }[])) {
    const key = u.created_at.slice(0, 10);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    const ch = channelById.get(u.id);
    if (ch === "web") bucket.web++;
    else if (ch === "app") bucket.app++;
    else bucket.unknown++;
  }

  return Array.from(buckets, ([date, v]) => ({ date, ...v }));
}
```

- [ ] **Step 2: Write failing tests**

Create `src/lib/members-stats.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock supabase-server BEFORE importing the lib.
const mockAdmin = {
  from: vi.fn(),
  schema: vi.fn(() => mockAdmin),
};
vi.mock("./supabase-server", () => ({
  getSupabaseAdmin: () => mockAdmin,
}));

import { getMembersStats } from "./members-stats";

function chainable(payload: unknown) {
  // Helper: Supabase query builder is chainable; final call returns
  // { data, error }. We return a thenable-ish object that resolves to
  // payload at any await point.
  const builder: Record<string, unknown> = {};
  const proxy: Record<string, unknown> = new Proxy(builder, {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => resolve(payload);
      }
      return () => proxy;
    },
  });
  return proxy;
}

describe("getMembersStats — Supabase KPIs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("totals web/app/unknown from user_profiles.signup_channel", async () => {
    mockAdmin.from.mockImplementation((table: string) => {
      if (table === "user_profiles") {
        // Two calls to user_profiles in the lib: counts (no filter) and
        // trend (no filter). Return same shape both times.
        return chainable({
          data: [
            { user_id: "u1", signup_channel: "web" },
            { user_id: "u2", signup_channel: "web" },
            { user_id: "u3", signup_channel: "app" },
            { user_id: "u4", signup_channel: null },
          ],
          error: null,
        });
      }
      if (table === "users") {
        return chainable({ data: [], error: null, count: 0 });
      }
      return chainable({ data: [], error: null });
    });

    const stats = await getMembersStats();

    expect(stats.kpis.totalMembers).toBe(4);
    expect(stats.kpis.web.count).toBe(2);
    expect(stats.kpis.app.count).toBe(1);
    expect(stats.kpis.unknown.count).toBe(1);
    expect(stats.kpis.web.pct).toBe(50);
    expect(stats.kpis.app.pct).toBe(25);
  });

  it("returns 0% for empty membership", async () => {
    mockAdmin.from.mockImplementation(() =>
      chainable({ data: [], error: null, count: 0 }),
    );

    const stats = await getMembersStats();

    expect(stats.kpis.totalMembers).toBe(0);
    expect(stats.kpis.web.pct).toBe(0);
  });

  it("trend has exactly 90 daily buckets in chronological order", async () => {
    mockAdmin.from.mockImplementation(() =>
      chainable({ data: [], error: null, count: 0 }),
    );

    const stats = await getMembersStats();

    expect(stats.trend).toHaveLength(90);
    const firstDate = new Date(stats.trend[0].date).getTime();
    const lastDate = new Date(stats.trend[89].date).getTime();
    expect(lastDate).toBeGreaterThan(firstDate);
  });
});
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
npx vitest run src/lib/members-stats.test.ts
```

Expected: 3 passing tests.

If failing, debug — the chainable `Proxy` is the most likely culprit. Replace with explicit method-by-method mocks (`.select`, `.gte`, etc.) if the Proxy approach proves brittle.

- [ ] **Step 4: Commit**

```bash
git add src/lib/members-stats.ts src/lib/members-stats.test.ts
git commit -m "feat(admin): members-stats lib (Supabase KPIs + trend)"
```

---

## Task 6: Members stats lib — Square-dependent fields

Adds `ordered` conversion, `loyalty` completion, `rewardsRedeemedThisMonth`, `funnel`, and `topCustomers` to `getMembersStats()`.

**Files:**
- Modify: `src/lib/members-stats.ts`
- Modify: `src/lib/members-stats.test.ts`

- [ ] **Step 1: Add Square helpers to the lib**

In `src/lib/members-stats.ts`, add at top with other imports:

```typescript
import { squareClient } from "./square";
```

Add these helpers below the existing functions, before `getMembersStats`:

```typescript
type ProfileRow = {
  user_id: string;
  square_customer_id: string;
  phone_e164: string;
  first_name: string | null;
  last_name: string | null;
  signup_channel: string | null;
};

async function fetchAllProfiles(): Promise<ProfileRow[]> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("user_profiles")
    .select("user_id, square_customer_id, phone_e164, first_name, last_name, signup_channel");
  if (error) throw new Error(`fetchAllProfiles: ${error.message}`);
  return (data ?? []) as ProfileRow[];
}

// Set of customerIds with at least one COMPLETED order in the trailing window.
async function fetchOrderingCustomers(
  windowDays: number,
): Promise<{ ordered: Set<string>; repeat: Set<string> }> {
  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!locationId) throw new Error("SQUARE_LOCATION_ID not set");

  const since = new Date(Date.now() - windowDays * 24 * 3600 * 1000).toISOString();
  const counts = new Map<string, number>();
  let cursor: string | undefined;

  do {
    const res = await squareClient.orders.search({
      locationIds: [locationId],
      cursor,
      query: {
        filter: {
          dateTimeFilter: { createdAt: { startAt: since } },
          stateFilter: { states: ["COMPLETED"] },
        },
      },
      limit: 500,
    });
    for (const order of res.orders ?? []) {
      const cid = order.customerId;
      if (!cid) continue;
      counts.set(cid, (counts.get(cid) ?? 0) + 1);
    }
    cursor = res.cursor;
  } while (cursor);

  const ordered = new Set(counts.keys());
  const repeat = new Set(
    Array.from(counts.entries())
      .filter(([, n]) => n >= 2)
      .map(([cid]) => cid),
  );
  return { ordered, repeat };
}

// Sum stats from Square loyalty accounts. Caller passes the set of
// customerIds we care about (members) — we filter so legacy in-store-only
// loyalty accounts don't pollute the dashboard's "member" view.
async function fetchLoyaltyStats(
  memberCustomerIds: Set<string>,
): Promise<{ withReward: number; balanceGte9: number }> {
  let withReward = 0;
  let balanceGte9 = 0;
  let cursor: string | undefined;

  do {
    const res = await squareClient.loyalty.accounts.search({
      cursor,
      query: {},
      limit: 200,
    });
    for (const acct of res.loyaltyAccounts ?? []) {
      const cid = acct.customerId;
      if (!cid || !memberCustomerIds.has(cid)) continue;
      const balance = Number(acct.balance ?? 0);
      const rewardsLen = (acct.availableRewards ?? []).length;
      if (rewardsLen > 0) withReward++;
      if (balance >= 9) balanceGte9++;
    }
    cursor = res.cursor;
  } while (cursor);

  return { withReward, balanceGte9 };
}

async function fetchRewardsRedeemedThisMonth(): Promise<number> {
  // Use Brisbane month start (consistent with KPIs).
  const now = brisbaneNow();
  const monthStart = startOfBrisbaneMonth(now).toISOString();

  let count = 0;
  let cursor: string | undefined;

  do {
    const res = await squareClient.loyalty.accounts.searchEvents({
      cursor,
      query: {
        filter: {
          typeFilter: { types: ["REDEEM_REWARD"] },
          dateTimeFilter: { createdAt: { startAt: monthStart } },
        },
      },
      limit: 200,
    });
    count += (res.events ?? []).length;
    cursor = res.cursor;
  } while (cursor);

  return count;
}

function maskPhone(e164: string | null): string {
  if (!e164) return "—";
  // +61412345678 → "+61 4xx xxx 678"
  const tail = e164.slice(-3);
  return `+61 4xx xxx ${tail}`;
}

async function fetchTopCustomers(profiles: ProfileRow[]): Promise<TopCustomer[]> {
  // Pull spend stats from Square per profile in batches. Square does not
  // expose lifetime spend on customers.search reliably, so use customers.get
  // which returns lifetimeSpendMoney. Cap at 200 profiles to keep latency
  // bounded; sort top 10 in memory.
  const sample = profiles.slice(0, 200);
  const enriched: TopCustomer[] = [];

  await Promise.all(
    sample.map(async (p) => {
      try {
        const res = await squareClient.customers.get({
          customerId: p.square_customer_id,
        });
        const c = res.customer;
        if (!c) return;
        const spend = Number(c.lifetimeSpendMoney?.amount ?? 0n);
        enriched.push({
          customerId: p.square_customer_id,
          name: [p.first_name, p.last_name].filter(Boolean).join(" ") || "—",
          phoneMasked: maskPhone(p.phone_e164),
          channel:
            p.signup_channel === "web" || p.signup_channel === "app"
              ? p.signup_channel
              : "unknown",
          totalOrders: Number(c.totalSpendCount ?? 0n) || 0,
          lifetimeSpendCents: spend,
          lastOrderAt: null, // Square does not expose lastOrderAt directly
        });
      } catch {
        // skip individual failures — one bad customer shouldn't crash the dashboard
      }
    }),
  );

  return enriched
    .sort((a, b) => b.lifetimeSpendCents - a.lifetimeSpendCents)
    .slice(0, 10);
}
```

- [ ] **Step 2: Wire the Square helpers into `getMembersStats()`**

Replace the body of `getMembersStats()` with the integrated version. Locate the existing function and update the section after `const trend = await fetchTrend(90)`:

```typescript
  const profiles = await fetchAllProfiles();
  const memberCustomerIds = new Set(profiles.map((p) => p.square_customer_id));

  const [orderingResult, loyaltyResult, redeemedResult, topResult] =
    await Promise.all([
      fetchOrderingCustomers(90),
      fetchLoyaltyStats(memberCustomerIds),
      fetchRewardsRedeemedThisMonth(),
      fetchTopCustomers(profiles),
    ]);

  const orderedMembers = profiles.filter((p) =>
    orderingResult.ordered.has(p.square_customer_id),
  ).length;
  const repeatMembers = profiles.filter((p) =>
    orderingResult.repeat.has(p.square_customer_id),
  ).length;
```

Then update the returned object's previously-zeroed fields:

```typescript
      ordered: {
        count: orderedMembers,
        total: counts.total,
        conversionPct: pct(orderedMembers, counts.total),
      },
      loyalty: loyaltyResult,
      rewardsRedeemedThisMonth: redeemedResult,
    },
    trend,
    channelDistribution: [
      { channel: "web", count: counts.web },
      { channel: "app", count: counts.app },
      { channel: "unknown", count: counts.unknown },
    ],
    funnel: {
      registered: counts.total,
      ordered: orderedMembers,
      repeat: repeatMembers,
    },
    topCustomers: topResult,
  };
}
```

- [ ] **Step 3: Add tests for the new logic**

Append to `src/lib/members-stats.test.ts`:

```typescript
import { squareClient } from "./square";

vi.mock("./square", () => ({
  squareClient: {
    orders: { search: vi.fn() },
    loyalty: {
      accounts: {
        search: vi.fn(),
        searchEvents: vi.fn(),
      },
    },
    customers: { get: vi.fn() },
  },
}));

describe("getMembersStats — Square-dependent KPIs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SQUARE_LOCATION_ID = "L_TEST";
  });

  it("computes ordered conversion and repeat from order history", async () => {
    mockAdmin.from.mockImplementation((table: string) => {
      if (table === "user_profiles") {
        return chainable({
          data: [
            {
              user_id: "u1",
              square_customer_id: "C1",
              phone_e164: "+61400000001",
              first_name: "A",
              last_name: null,
              signup_channel: "web",
            },
            {
              user_id: "u2",
              square_customer_id: "C2",
              phone_e164: "+61400000002",
              first_name: "B",
              last_name: null,
              signup_channel: "app",
            },
            {
              user_id: "u3",
              square_customer_id: "C3",
              phone_e164: "+61400000003",
              first_name: "C",
              last_name: null,
              signup_channel: "web",
            },
          ],
          error: null,
        });
      }
      if (table === "users") {
        return chainable({ data: [], error: null, count: 0 });
      }
      return chainable({ data: [], error: null });
    });

    (squareClient.orders.search as ReturnType<typeof vi.fn>).mockResolvedValue({
      orders: [
        { customerId: "C1" },
        { customerId: "C1" },
        { customerId: "C2" },
        // C3 has no orders
      ],
      cursor: undefined,
    });
    (squareClient.loyalty.accounts.search as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ loyaltyAccounts: [], cursor: undefined });
    (squareClient.loyalty.accounts.searchEvents as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ events: [], cursor: undefined });
    (squareClient.customers.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: {
        lifetimeSpendMoney: { amount: 0n },
        totalSpendCount: 0n,
      },
    });

    const stats = await getMembersStats();

    expect(stats.kpis.ordered.count).toBe(2); // C1 + C2
    expect(stats.kpis.ordered.total).toBe(3);
    expect(stats.kpis.ordered.conversionPct).toBeCloseTo(66.7, 1);
    expect(stats.funnel).toEqual({ registered: 3, ordered: 2, repeat: 1 });
  });

  it("filters loyalty stats to known member customerIds", async () => {
    mockAdmin.from.mockImplementation((table: string) => {
      if (table === "user_profiles") {
        return chainable({
          data: [
            {
              user_id: "u1",
              square_customer_id: "MEMBER",
              phone_e164: "+61400000001",
              first_name: null, last_name: null, signup_channel: "web",
            },
          ],
          error: null,
        });
      }
      if (table === "users") {
        return chainable({ data: [], error: null, count: 0 });
      }
      return chainable({ data: [], error: null });
    });

    (squareClient.orders.search as ReturnType<typeof vi.fn>).mockResolvedValue({
      orders: [], cursor: undefined,
    });
    (squareClient.loyalty.accounts.search as ReturnType<typeof vi.fn>)
      .mockResolvedValue({
        loyaltyAccounts: [
          { customerId: "MEMBER", balance: 12, availableRewards: [{ id: "r1" }] },
          { customerId: "STRANGER", balance: 99, availableRewards: [{ id: "r2" }] },
        ],
        cursor: undefined,
      });
    (squareClient.loyalty.accounts.searchEvents as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ events: [], cursor: undefined });
    (squareClient.customers.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { lifetimeSpendMoney: { amount: 0n }, totalSpendCount: 0n },
    });

    const stats = await getMembersStats();

    // STRANGER's account should be ignored — only MEMBER counts.
    expect(stats.kpis.loyalty.balanceGte9).toBe(1);
    expect(stats.kpis.loyalty.withReward).toBe(1);
  });
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/members-stats.test.ts
```

Expected: 5 passing tests total (3 from Task 5 + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/members-stats.ts src/lib/members-stats.test.ts
git commit -m "feat(admin): members-stats Square layer (orders, loyalty, top customers)"
```

---

## Task 7: API route `/api/admin/members-stats`

**Files:**
- Create: `src/app/api/admin/members-stats/route.ts`

- [ ] **Step 1: Write the route**

Create `src/app/api/admin/members-stats/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getSupabaseAdmin, getSupabaseRoute } from "@/lib/supabase-server";
import { getMembersStats } from "@/lib/members-stats";

// 5-minute ISR — admin checks this a few times per day, latency over
// freshness. Bump to revalidate: 0 if stats feel stale.
export const revalidate = 300;

export async function GET() {
  // Re-check admin gate at the API level so a stolen session or direct
  // curl can't read the data even if the page is bypassed.
  const ssr = await getSupabaseRoute();
  const { data: { user } } = await ssr.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const admin = getSupabaseAdmin();
  const { data: row } = await admin
    .from("admin_users")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!row) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const stats = await getMembersStats();
    return NextResponse.json({ ok: true, stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[admin/members-stats]", message);
    return NextResponse.json(
      { ok: false, error: "Failed to load stats" },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Verify auth gate locally**

```bash
npm run dev
```

In another terminal:

```bash
curl -i http://localhost:3000/api/admin/members-stats
```

Expected: `HTTP/1.1 401 Unauthorized` (no session cookie).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/members-stats/route.ts
git commit -m "feat(admin): /api/admin/members-stats endpoint"
```

---

## Task 8: KpiTile component

**Files:**
- Create: `src/components/admin/KpiTile.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/admin/KpiTile.tsx`:

```tsx
type Props = {
  label: string;
  value: string | number;
  subtitle?: string;
  trend?: { deltaPct: number | null; previousLabel: string };
};

export function KpiTile({ label, value, subtitle, trend }: Props) {
  const arrow = trend?.deltaPct == null
    ? null
    : trend.deltaPct > 0
      ? "▲"
      : trend.deltaPct < 0
        ? "▼"
        : "→";
  const arrowColor = trend?.deltaPct == null
    ? "text-zinc-500"
    : trend.deltaPct > 0
      ? "text-emerald-600"
      : trend.deltaPct < 0
        ? "text-red-600"
        : "text-zinc-500";

  return (
    <div className="rounded-lg border border-black/10 bg-[#F5E6C8] p-4">
      <p className="text-xs uppercase tracking-wide text-zinc-700">{label}</p>
      <p className="mt-1 text-3xl font-bold text-zinc-900">{value}</p>
      {subtitle && (
        <p className="mt-1 text-xs text-zinc-600">{subtitle}</p>
      )}
      {trend && (
        <p className={`mt-2 text-xs ${arrowColor}`}>
          {arrow}{" "}
          {trend.deltaPct == null
            ? "—"
            : `${trend.deltaPct > 0 ? "+" : ""}${trend.deltaPct}%`}{" "}
          <span className="text-zinc-500">vs {trend.previousLabel}</span>
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/KpiTile.tsx
git commit -m "feat(admin): KpiTile presentational component"
```

---

## Task 9: ChannelDonut component

**Files:**
- Create: `src/components/admin/ChannelDonut.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

type Props = {
  data: { channel: "web" | "app" | "unknown"; count: number }[];
};

const COLORS: Record<Props["data"][number]["channel"], string> = {
  web: "#C43A10",
  app: "#1F4FE3",
  unknown: "#A1A1AA",
};

export function ChannelDonut({ data }: Props) {
  return (
    <div className="rounded-lg border border-black/10 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-zinc-900">
        Registration channel
      </h3>
      <div className="h-56">
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="channel"
              innerRadius={50}
              outerRadius={80}
              paddingAngle={2}
            >
              {data.map((entry) => (
                <Cell key={entry.channel} fill={COLORS[entry.channel]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex justify-center gap-4 text-xs">
        {data.map((entry) => (
          <span
            key={entry.channel}
            className="flex items-center gap-1 text-zinc-700"
          >
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: COLORS[entry.channel] }}
            />
            {entry.channel} ({entry.count})
          </span>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/ChannelDonut.tsx
git commit -m "feat(admin): ChannelDonut chart"
```

---

## Task 10: MembersTrendChart component

**Files:**
- Create: `src/components/admin/MembersTrendChart.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";

type Props = {
  data: { date: string; web: number; app: number; unknown: number }[];
};

export function MembersTrendChart({ data }: Props) {
  return (
    <div className="rounded-lg border border-black/10 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-zinc-900">
        New members — last 90 days
      </h3>
      <div className="h-64">
        <ResponsiveContainer>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10 }}
              tickFormatter={(v: string) => v.slice(5)}
              minTickGap={20}
            />
            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
            <Tooltip />
            <Legend />
            <Line
              type="monotone"
              dataKey="web"
              stroke="#C43A10"
              dot={false}
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="app"
              stroke="#1F4FE3"
              dot={false}
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="unknown"
              stroke="#A1A1AA"
              dot={false}
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/MembersTrendChart.tsx
git commit -m "feat(admin): MembersTrendChart"
```

---

## Task 11: FunnelBars component

**Files:**
- Create: `src/components/admin/FunnelBars.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";

type Props = {
  data: { registered: number; ordered: number; repeat: number };
};

export function FunnelBars({ data }: Props) {
  const rows = [
    { stage: "Registered", count: data.registered },
    { stage: "Placed ≥1 order", count: data.ordered },
    { stage: "Repeat (≥2 orders)", count: data.repeat },
  ];

  return (
    <div className="rounded-lg border border-black/10 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-zinc-900">
        Registration → first order funnel (last 90 days of orders)
      </h3>
      <div className="h-56">
        <ResponsiveContainer>
          <BarChart data={rows} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
            <YAxis
              type="category"
              dataKey="stage"
              width={140}
              tick={{ fontSize: 11 }}
            />
            <Tooltip />
            <Bar dataKey="count" fill="#C43A10" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/FunnelBars.tsx
git commit -m "feat(admin): FunnelBars chart"
```

---

## Task 12: TopCustomersTable component

**Files:**
- Create: `src/components/admin/TopCustomersTable.tsx`

- [ ] **Step 1: Write the component**

```tsx
import type { TopCustomer } from "@/lib/members-stats";

type Props = { customers: TopCustomer[] };

function formatAud(cents: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(cents / 100);
}

export function TopCustomersTable({ customers }: Props) {
  return (
    <div className="rounded-lg border border-black/10 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-zinc-900">
        Top 10 customers (by lifetime spend)
      </h3>
      {customers.length === 0 ? (
        <p className="text-sm text-zinc-500">No data yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-xs uppercase tracking-wide text-zinc-600">
                <th className="py-2 pr-3">#</th>
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Phone</th>
                <th className="py-2 pr-3">Channel</th>
                <th className="py-2 pr-3 text-right">Orders</th>
                <th className="py-2 pr-3 text-right">Spend</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c, i) => (
                <tr key={c.customerId} className="border-b border-black/5">
                  <td className="py-2 pr-3 text-zinc-500">{i + 1}</td>
                  <td className="py-2 pr-3 font-medium text-zinc-900">
                    {c.name}
                  </td>
                  <td className="py-2 pr-3 text-zinc-700">{c.phoneMasked}</td>
                  <td className="py-2 pr-3 text-zinc-700">{c.channel}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-zinc-700">
                    {c.totalOrders}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums font-medium text-zinc-900">
                    {formatAud(c.lifetimeSpendCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/TopCustomersTable.tsx
git commit -m "feat(admin): TopCustomersTable"
```

---

## Task 13: Wire it together — `/admin/members` page

**Files:**
- Create: `src/app/admin/members/page.tsx`
- Create: `src/app/admin/members/MembersDashboard.tsx`

The server component fetches data; the client component owns the charts (Recharts requires browser).

- [ ] **Step 1: Write the client component**

Create `src/app/admin/members/MembersDashboard.tsx`:

```tsx
"use client";

import { ChannelDonut } from "@/components/admin/ChannelDonut";
import { FunnelBars } from "@/components/admin/FunnelBars";
import { MembersTrendChart } from "@/components/admin/MembersTrendChart";
import type { MembersStats } from "@/lib/members-stats";

type Props = { stats: MembersStats };

export function MembersDashboardCharts({ stats }: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <MembersTrendChart data={stats.trend} />
      <ChannelDonut data={stats.channelDistribution} />
      <FunnelBars data={stats.funnel} />
    </div>
  );
}
```

- [ ] **Step 2: Write the page (server component)**

Create `src/app/admin/members/page.tsx`:

```tsx
import { KpiTile } from "@/components/admin/KpiTile";
import { TopCustomersTable } from "@/components/admin/TopCustomersTable";
import { getMembersStats } from "@/lib/members-stats";
import { MembersDashboardCharts } from "./MembersDashboard";

export const dynamic = "force-dynamic";
export const revalidate = 300;

function formatAge(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 minute ago";
  return `${minutes} minutes ago`;
}

export default async function MembersDashboardPage() {
  const stats = await getMembersStats();

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Members</h1>
        <p className="text-xs text-zinc-500">
          As of {formatAge(stats.generatedAt)}
        </p>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Total members"
          value={stats.kpis.totalMembers}
          subtitle={
            stats.kpis.unknown.count > 0
              ? `${stats.kpis.unknown.count} unknown channel`
              : undefined
          }
        />
        <KpiTile
          label="Web registrations"
          value={stats.kpis.web.count}
          subtitle={`${stats.kpis.web.pct}% of total`}
        />
        <KpiTile
          label="App registrations"
          value={stats.kpis.app.count}
          subtitle={`${stats.kpis.app.pct}% of total`}
        />
        <KpiTile
          label="Ordered / Registered"
          value={`${stats.kpis.ordered.count} / ${stats.kpis.ordered.total}`}
          subtitle={`${stats.kpis.ordered.conversionPct}% conversion`}
        />
        <KpiTile
          label="New this month"
          value={stats.kpis.newThisMonth.count}
          trend={{
            deltaPct: stats.kpis.newThisMonth.deltaPct,
            previousLabel: "last month",
          }}
        />
        <KpiTile
          label="New this week"
          value={stats.kpis.newThisWeek.count}
          trend={{
            deltaPct: stats.kpis.newThisWeek.deltaPct,
            previousLabel: "last week",
          }}
        />
        <KpiTile
          label="Loyalty 9-of-9"
          value={stats.kpis.loyalty.balanceGte9}
          subtitle={`${stats.kpis.loyalty.withReward} with active reward`}
        />
        <KpiTile
          label="Rewards redeemed"
          value={stats.kpis.rewardsRedeemedThisMonth}
          subtitle="this month"
        />
      </div>

      <div className="mb-6">
        <MembersDashboardCharts stats={stats} />
      </div>

      <TopCustomersTable customers={stats.topCustomers} />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Manual UI verification (per `feedback_mandys_dev_server.md`)**

```bash
npm run dev
```

The page requires admin auth, so:
1. Sign in to your local Supabase as your own account.
2. Manually insert your `auth.users.id` into `admin_users` via Supabase Studio (one row, role='admin'). See Task 15 runbook.
3. Visit `http://localhost:3000/admin/members`.

Use cmux browser to verify (per /dev skill):

```bash
cmux new-pane --type browser --direction right --url http://localhost:3000/admin/members
cmux browser errors list   # must be empty
cmux browser console list  # check for hydration / Recharts warnings
cmux browser screenshot --out /tmp/cmux-members-dashboard.png
```

Open the screenshot via Read and confirm:
- 8 KPI tiles render in a grid (1 col mobile, 2 col tablet, 4 col desktop)
- 3 charts render below
- Top customers table at bottom
- "As of X minutes ago" timestamp in header
- No console errors

If the page is slow on first load (>5s), that's expected on a cold cache; second load should hit ISR.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/members/page.tsx src/app/admin/members/MembersDashboard.tsx
git commit -m "feat(admin): /admin/members dashboard page"
```

---

## Task 14: Cross-repo coordination doc — RN app `channel: 'app'` change

**Files:**
- Create: `docs/superpowers/runbooks/members-dashboard-rollout.md`

The RN app lives in a separate repo (`~/Github/mandys_bubble_tea_app`). This task only documents the change so it can be picked up there in the next release.

- [ ] **Step 1: Write the runbook**

Create `docs/superpowers/runbooks/members-dashboard-rollout.md`:

```markdown
# Members Dashboard Rollout Runbook

## 1. Apply DB migration

In Supabase Studio (prod project):
1. Open SQL Editor.
2. Paste contents of `supabase/migrations/2026-04-26-signup-channel.sql`.
3. Run. Expect: `ALTER TABLE`, then `ALTER TABLE` (constraint), then a single `UPDATE` whose row count equals `count(user_profiles)`.
4. Re-run the same SQL once to confirm idempotence (UPDATE row count should be 0).

## 2. Grant yourself admin access

```sql
INSERT INTO public.admin_users (user_id, role)
VALUES ('<your auth.users.id from Supabase>', 'admin')
ON CONFLICT (user_id) DO NOTHING;
```

Find your `user_id` in Supabase Studio → Authentication → Users → click your row → copy ID.

## 3. Deploy web app

Push branch → Vercel auto-deploys. Visit `https://mandybubbletea.com/admin/members`. Verify:
- 8 KPI tiles render
- 3 charts render
- Top customers populated (assuming any customers exist)
- "Unknown channel" subtitle on the Total Members tile shows whatever the backfill couldn't classify

## 4. RN app change (separate repo)

Repo: `~/Github/mandys_bubble_tea_app`

Find the equivalent of `completeSignup` in the app — likely an API helper that POSTs to `/api/auth/complete-signup`. Add `channel: 'app'` to the request body. Search for `complete-signup` to locate it:

```bash
cd ~/Github/mandys_bubble_tea_app
grep -rn "complete-signup" src/
```

The change is one line:

```diff
  body: JSON.stringify({
    firstName,
    lastName,
+   channel: "app",
  }),
```

Test: in dev, register a fresh test user via the app, then in Supabase Studio query
`SELECT signup_channel FROM user_profiles WHERE user_id = '<that user>';` — must return `'app'`.

Ship in the next App Store release. Until then, app-originated signups land with `signup_channel = NULL` and surface in the dashboard's "Unknown channel" subtitle on the Total Members tile.

## 5. Phase 2 follow-up (after RN release ships + ≥7 days of clean signups)

Add a follow-up migration that enforces NOT NULL:

```sql
-- supabase/migrations/YYYY-MM-DD-signup-channel-not-null.sql
ALTER TABLE public.user_profiles
  ALTER COLUMN signup_channel SET NOT NULL;
```

Before applying, confirm zero NULL rows exist:
`SELECT COUNT(*) FROM user_profiles WHERE signup_channel IS NULL;` — must be 0.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/runbooks/members-dashboard-rollout.md
git commit -m "docs: members-dashboard-rollout runbook"
```

---

## Task 15: Pre-deploy checks

**Files:** none — this is a verification task.

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run
```

Expected: all existing tests + 5 new members-stats tests PASS.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Expected: PASS (or only warnings already present pre-change).

- [ ] **Step 4: Apply migration to local dev**

If running Supabase locally, apply the migration. Otherwise skip — apply against prod via runbook step 1 at deploy time.

- [ ] **Step 5: Smoke test the API route**

```bash
npm run dev
```

In another terminal, with your local admin session cookie:

```bash
# Without cookie — must 401
curl -i http://localhost:3000/api/admin/members-stats

# Then in browser, while signed in as an admin, visit:
# http://localhost:3000/api/admin/members-stats
# Expect a JSON payload matching the MembersStats type.
```

- [ ] **Step 6: Open a PR**

The members dashboard is on its own branch. Open a PR to main with:
- Title: `feat(admin): members dashboard`
- Description: link the spec doc and this plan doc
- Test plan: list `npx vitest run`, typecheck, lint, manual `/admin/members` smoke

Do NOT merge until:
1. Migration is applied to prod via Supabase Studio
2. `admin_users` row exists for the operator
3. Vercel preview shows the page rendering against prod data

---

## Out of scope (do not implement)

- "Active" / "dormant" cohort breakdowns — owner asked to skip
- SKU / modifier-combination revenue analytics
- Outbound messaging (push, SMS, email) from this page
- Order management (refund / edit / cancel)
- Background pre-aggregation cron — only if 5-min ISR proves too slow
- The Phase 2 NOT NULL migration on `signup_channel` — separate task in DEV_QUEUE after RN release ships
