# Online Ordering POS Backup Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an operator-toggled "POS backup mode" switch that extends online ordering from 22:15 to 22:30 Brisbane when the in-store POS fails, persisted in a new Supabase KV table and toggled from the admin `/members` page top banner.

**Architecture:** New `app_settings` KV table in Mandy web Supabase (project `fsvtwivogyebugqhmjjy`) with a `pos_backup_mode` row. Server-side gate `getEffectiveOrderingStatus()` reads the setting (60s in-process memo). New public `GET /api/store-status` endpoint feeds the customer cart/checkout UI via 30s poll. New admin `GET/PATCH /api/admin/settings/ordering` endpoints (HMAC-cookie gated) read/write the setting; a `<OrderingModeBanner>` at the top of admin `/members` lets the operator flip the mode. Migration applies + flips to `pos_backup_mode = true` immediately.

**Tech Stack:** Next.js 14 App Router · Supabase Postgres + RLS · vitest · TypeScript strict · two repos: `~/Github/mandys_bubble_tea-hours` (web, on `main`) and `~/Github/mandys_bubble_tea_admin` (admin, on `main`).

**Repos & branches:**
- Web: `~/Github/mandys_bubble_tea-hours` worktree, `main` branch. New feature branch `feat/pos-backup-mode` to cut PR.
- Admin: `~/Github/mandys_bubble_tea_admin`, `main` branch. New feature branch `feat/pos-backup-mode`.

---

## File Structure

### Web repo (`~/Github/mandys_bubble_tea-hours`)

**Create:**
- `supabase/migrations/2026-05-16-app-settings.sql` — table + RLS + seed + immediate flip to `true`
- `src/app/api/store-status/route.ts` — public `GET`, returns effective `OrderingStatus`
- `src/app/api/store-status/route.test.ts` — vitest for the route
- `src/lib/__mocks__/supabase.ts` — minimal mock shape for `getSupabaseAdmin().from('app_settings').select(...)` used in tests **only if** a project-wide pattern doesn't already exist (check before creating; if mandy web already mocks supabase elsewhere, reuse)

**Modify:**
- `src/lib/store-status.ts` — add `getEffectiveOrderingStatus()` + 60s in-process memo; keep `getOrderingStatus()` untouched
- `src/lib/store-status.test.ts` — add `describe('getEffectiveOrderingStatus', ...)` with 8 cases
- `src/app/api/orders/route.ts` — swap line 120 from sync `getOrderingStatus()` to `await getEffectiveOrderingStatus()`
- `src/components/cart/CartDrawer.tsx` — lines ~688-691: replace sync compute + 60s `setInterval` with `fetch('/api/store-status')` + 30s poll
- `src/app/checkout/page.tsx` — lines ~222-225: same swap as CartDrawer

### Admin repo (`~/Github/mandys_bubble_tea_admin`)

**Create:**
- `src/app/api/admin/settings/ordering/route.ts` — `GET` (read row) + `PATCH` (upsert with `updated_by = verifiedSession.email`)
- `src/app/api/admin/settings/ordering/route.test.ts` — vitest for both methods
- `src/components/OrderingModeBanner.tsx` — client component, two-radio panel + optimistic PATCH + audit line
- `src/components/OrderingModeBanner.test.tsx` — vitest + React Testing Library for the banner

**Modify:**
- `src/middleware.ts` — add `/api/admin/settings` to `PROTECTED_API_PREFIXES`
- `src/app/members/page.tsx` — render `<OrderingModeBanner>` above existing `MembersDashboard` (server component fetches initial state + passes as prop)

---

## Task 1: Web — `app_settings` table migration

**Files:**
- Create: `supabase/migrations/2026-05-16-app-settings.sql`

- [ ] **Step 1: Pin web worktree to fresh feature branch**

```bash
cd ~/Github/mandys_bubble_tea-hours
git fetch origin
git checkout -b feat/pos-backup-mode origin/main
```

Expected: branch created, HEAD on origin/main (currently `366b2bf docs(tester): mandys-tester v1 implementation plans (P0-P6)`).

- [ ] **Step 2: Write the migration file**

Create `supabase/migrations/2026-05-16-app-settings.sql`:

```sql
-- Key-value site-wide settings. First key: pos_backup_mode (boolean) —
-- when true, online ordering cutoff matches physical close (22:30 BNE)
-- instead of the default 22:15 (which leaves 15min for staff to finish
-- the last cup). Operator toggles this from admin /members.

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT  -- admin identifier (ADMIN_EMAIL from HMAC session). Not a
                   -- FK to auth.users: admin auth runs on env creds, not Supabase auth.
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Read: public. Cart UI on the customer site reads effective ordering state
-- (the actual read happens server-side via service_role today, but a public
-- read policy keeps the door open if we ever fetch from the browser client).
CREATE POLICY "app_settings_read_all"
  ON app_settings
  FOR SELECT
  USING (true);

-- Write: service_role only. No INSERT/UPDATE/DELETE policy → denies anon
-- and authenticated. Admin endpoint uses getSupabaseAdmin() which is
-- service-role-keyed.

-- Seed + immediate switch-on. Re-running the migration is idempotent.
INSERT INTO app_settings (key, value, updated_by)
VALUES ('pos_backup_mode', 'true'::jsonb, 'migration-seed')
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value, updated_at = now();
```

- [ ] **Step 3: Apply migration to Mandy web Supabase via MCP**

Use `mcp__supabase__apply_migration` with `project_id = "fsvtwivogyebugqhmjjy"`, `name = "2026-05-16-app-settings"`, query = full SQL above.

Expected: tool returns success. No staging — Mandy web Supabase has a single environment.

- [ ] **Step 4: Verify the row exists and is `true`**

Use `mcp__supabase__execute_sql` with `project_id = "fsvtwivogyebugqhmjjy"`:

```sql
SELECT key, value, updated_at, updated_by FROM app_settings WHERE key = 'pos_backup_mode';
```

Expected: 1 row, `value = true`, `updated_by = 'migration-seed'`, `updated_at` ≈ now.

- [ ] **Step 5: Commit**

```bash
cd ~/Github/mandys_bubble_tea-hours
git add supabase/migrations/2026-05-16-app-settings.sql
git commit -m "feat(db): app_settings kv table + pos_backup_mode row seeded true"
```

---

## Task 2: Web — `getEffectiveOrderingStatus()` (TDD)

**Files:**
- Modify: `src/lib/store-status.ts`
- Modify: `src/lib/store-status.test.ts`

- [ ] **Step 1: Read current `store-status.ts` and `store-status.test.ts` so the test you add lines up with the existing `brisbane()` test helper and `getOrderingStatus` signature**

Run: `cat src/lib/store-status.ts src/lib/store-status.test.ts`

Note the `brisbane(yyyyMmDd, h, m)` helper and `OrderingStatus` shape.

- [ ] **Step 2: Write the failing tests**

Append to `src/lib/store-status.test.ts`:

```ts
import { vi, beforeEach, afterEach } from "vitest";
import {
  getEffectiveOrderingStatus,
  __resetPosBackupCacheForTests,
} from "./store-status";

// Mock supabase-server module's getSupabaseAdmin so we can swap the
// returned value per test. The shape matches a minimal Supabase
// SelectQueryBuilder for `from('app_settings').select('value').eq('key',…).maybeSingle()`.
const mockMaybeSingle = vi.fn();
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseAdmin: () => ({
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          maybeSingle: mockMaybeSingle,
        }),
      }),
    }),
  }),
}));

describe("getEffectiveOrderingStatus", () => {
  beforeEach(() => {
    __resetPosBackupCacheForTests();
    mockMaybeSingle.mockReset();
  });

  it("pos_backup_mode=true: 22:14 BNE → open with 'until 10:30pm'", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { value: true }, error: null });
    expect(await getEffectiveOrderingStatus(brisbane("2026-05-16", 22, 14)))
      .toEqual({ open: true, nextLabel: "until 10:30pm" });
  });

  it("pos_backup_mode=true: 22:15 BNE → still open (backup mode kills cutoff)", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { value: true }, error: null });
    expect((await getEffectiveOrderingStatus(brisbane("2026-05-16", 22, 15))).open).toBe(true);
  });

  it("pos_backup_mode=true: 22:29 BNE → open", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { value: true }, error: null });
    expect((await getEffectiveOrderingStatus(brisbane("2026-05-16", 22, 29))).open).toBe(true);
  });

  it("pos_backup_mode=true: 22:30 BNE → closed", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { value: true }, error: null });
    const status = await getEffectiveOrderingStatus(brisbane("2026-05-16", 22, 30));
    expect(status.open).toBe(false);
    expect(status.nextLabel.startsWith("Opens")).toBe(true);
  });

  it("pos_backup_mode=false: 22:14 BNE → open with 'until 10:15pm'", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { value: false }, error: null });
    expect(await getEffectiveOrderingStatus(brisbane("2026-05-16", 22, 14)))
      .toEqual({ open: true, nextLabel: "until 10:15pm" });
  });

  it("pos_backup_mode=false: 22:15 BNE → closed (cutoff hits)", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { value: false }, error: null });
    expect((await getEffectiveOrderingStatus(brisbane("2026-05-16", 22, 15))).open).toBe(false);
  });

  it("pos_backup_mode=true: 10:29 BNE → still closed (open-time unchanged)", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { value: true }, error: null });
    expect((await getEffectiveOrderingStatus(brisbane("2026-05-16", 10, 29))).open).toBe(false);
  });

  it("setting row missing → falls back to default (false / with_cutoff)", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    // 22:15 should be CLOSED under default (cutoff hits)
    expect((await getEffectiveOrderingStatus(brisbane("2026-05-16", 22, 15))).open).toBe(false);
  });

  it("supabase fetch throws → falls back to default (defensive)", async () => {
    mockMaybeSingle.mockRejectedValue(new Error("network down"));
    expect((await getEffectiveOrderingStatus(brisbane("2026-05-16", 22, 15))).open).toBe(false);
  });
});
```

- [ ] **Step 3: Run the tests, verify they fail with "getEffectiveOrderingStatus is not a function"**

Run: `pnpm test src/lib/store-status.test.ts`
Expected: 9 new tests fail (1st run will fail at import — `getEffectiveOrderingStatus` and `__resetPosBackupCacheForTests` not exported yet).

- [ ] **Step 4: Implement `getEffectiveOrderingStatus` + memo**

Edit `src/lib/store-status.ts`. Add after the existing `getOrderingStatus` function:

```ts
import { getSupabaseAdmin } from "@/lib/supabase-server";

const POS_BACKUP_CACHE_TTL_MS = 60_000;
let posBackupCache: { value: boolean; fetchedAt: number } | null = null;

export function __resetPosBackupCacheForTests(): void {
  posBackupCache = null;
}

async function readPosBackupMode(): Promise<boolean> {
  const now = Date.now();
  if (posBackupCache && now - posBackupCache.fetchedAt < POS_BACKUP_CACHE_TTL_MS) {
    return posBackupCache.value;
  }
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("app_settings")
      .select("value")
      .eq("key", "pos_backup_mode")
      .maybeSingle();
    if (error) throw error;
    const value = data?.value === true;
    posBackupCache = { value, fetchedAt: now };
    return value;
  } catch {
    // Defensive: never let a Supabase outage close the store unexpectedly.
    // Fall back to the conservative "with cutoff" default (false).
    posBackupCache = { value: false, fetchedAt: now };
    return false;
  }
}

export async function getEffectiveOrderingStatus(
  now: Date = new Date(),
): Promise<OrderingStatus> {
  const backup = await readPosBackupMode();
  if (!backup) return getOrderingStatus(now);

  // Backup mode: cutoff = physical close (22:30) instead of 22:15.
  const minutes = brisbaneMinutes(now);
  const isOpen = minutes >= OPEN_MIN && minutes < CLOSE_MIN;
  if (isOpen) {
    return { open: true, nextLabel: `until ${formatClock(CLOSE_MIN)}` };
  }
  const beforeOpen = minutes < OPEN_MIN;
  return {
    open: false,
    nextLabel: beforeOpen
      ? `Opens ${formatClock(OPEN_MIN)}`
      : `Opens ${formatClock(OPEN_MIN)} tomorrow`,
  };
}
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `pnpm test src/lib/store-status.test.ts`
Expected: existing tests still green + 9 new tests pass.

- [ ] **Step 6: Type-check**

Run: `pnpm typecheck`
Expected: no new errors. Pre-existing baseline (e.g. `scripts/dump-bitmap-png.ts` TS5097 noise) unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/lib/store-status.ts src/lib/store-status.test.ts
git commit -m "feat(store-status): getEffectiveOrderingStatus with pos_backup_mode + 60s memo"
```

---

## Task 3: Web — `GET /api/store-status` route

**Files:**
- Create: `src/app/api/store-status/route.ts`
- Create: `src/app/api/store-status/route.test.ts`

- [ ] **Step 1: Write the failing route test**

Create `src/app/api/store-status/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";

vi.mock("@/lib/store-status", async () => {
  const actual = await vi.importActual<typeof import("@/lib/store-status")>(
    "@/lib/store-status",
  );
  return {
    ...actual,
    getEffectiveOrderingStatus: vi.fn(),
  };
});

import { getEffectiveOrderingStatus } from "@/lib/store-status";

describe("GET /api/store-status", () => {
  beforeEach(() => {
    vi.mocked(getEffectiveOrderingStatus).mockReset();
  });

  it("returns effective status JSON", async () => {
    vi.mocked(getEffectiveOrderingStatus).mockResolvedValue({
      open: true,
      nextLabel: "until 10:30pm",
    });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ open: true, nextLabel: "until 10:30pm" });
  });

  it("sets edge-cache header", async () => {
    vi.mocked(getEffectiveOrderingStatus).mockResolvedValue({
      open: false,
      nextLabel: "Opens 10:30am",
    });
    const res = await GET();
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=30");
  });
});
```

- [ ] **Step 2: Run test, verify it fails (module not found)**

Run: `pnpm test src/app/api/store-status/route.test.ts`
Expected: FAIL — `./route` does not exist yet.

- [ ] **Step 3: Implement the route**

Create `src/app/api/store-status/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getEffectiveOrderingStatus } from "@/lib/store-status";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getEffectiveOrderingStatus(new Date());
  return NextResponse.json(status, {
    headers: {
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=30",
    },
  });
}
```

- [ ] **Step 4: Run test, verify both pass**

Run: `pnpm test src/app/api/store-status/route.test.ts`
Expected: 2/2 pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/store-status/route.ts src/app/api/store-status/route.test.ts
git commit -m "feat(api): GET /api/store-status returns effective ordering status (30s edge cache)"
```

---

## Task 4: Web — swap `/api/orders` server gate to effective status

**Files:**
- Modify: `src/app/api/orders/route.ts:120`

- [ ] **Step 1: Locate the existing import + call site**

Run: `grep -n "getOrderingStatus" src/app/api/orders/route.ts`
Expected: 2 hits — one import (line 7-ish), one call (line ~120).

- [ ] **Step 2: Modify the import line**

Change:
```ts
import { getOrderingStatus } from "@/lib/store-status";
```
To:
```ts
import { getEffectiveOrderingStatus } from "@/lib/store-status";
```

- [ ] **Step 3: Modify the call site (`ordering = getOrderingStatus(...)`)**

Around line 120, change:
```ts
const ordering = getOrderingStatus(new Date());
```
To:
```ts
const ordering = await getEffectiveOrderingStatus(new Date());
```

Verify the surrounding function is already `async` — `/api/orders` POST route is async. The `await` is safe.

- [ ] **Step 4: Run type-check + full test suite**

Run: `pnpm typecheck && pnpm test`
Expected: no new errors, all tests still pass (orders route tests, if any, must keep passing — if they call the route handler they'll need their store-status mock updated; if they do, update the mock to mock `getEffectiveOrderingStatus` as an async fn returning the same shape).

If orders route tests fail because they were stubbing the sync function, fix the stub in the same commit. Show what changed and re-run.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/orders/route.ts
# If any test file also updated:
# git add src/app/api/orders/__tests__/*.ts
git commit -m "feat(orders): server gate honors pos_backup_mode via getEffectiveOrderingStatus"
```

---

## Task 5: Web — cart drawer + checkout poll refactor

**Files:**
- Modify: `src/components/cart/CartDrawer.tsx` (lines ~19, ~688-691)
- Modify: `src/app/checkout/page.tsx` (lines ~22, ~222-225)

- [ ] **Step 1: Read both files around the call sites**

Run: `grep -n "getOrderingStatus\|OrderingStatus" src/components/cart/CartDrawer.tsx src/app/checkout/page.tsx`

- [ ] **Step 2: Refactor CartDrawer**

In `src/components/cart/CartDrawer.tsx`:

a. Replace the import line:
```ts
import { getOrderingStatus, type OrderingStatus } from "@/lib/store-status";
```
with:
```ts
import type { OrderingStatus } from "@/lib/store-status";
```

b. Replace the existing `useState(getOrderingStatus())` + 60s `setInterval` block (lines ~688-691) with a fetch-and-poll pattern:

```ts
const [orderingStatus, setOrderingStatus] = useState<OrderingStatus | null>(null);
useEffect(() => {
  let cancelled = false;
  async function pull() {
    try {
      const res = await fetch("/api/store-status", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as OrderingStatus;
      if (!cancelled) setOrderingStatus(data);
    } catch {
      /* keep last-known good value */
    }
  }
  pull();
  const id = setInterval(pull, 30_000);
  return () => {
    cancelled = true;
    clearInterval(id);
  };
}, []);
```

c. Any consumer downstream that previously did `orderingStatus.open` must guard for `null` (initial pre-fetch render). Add a helper at the same level:
```ts
const orderingKnown = orderingStatus !== null;
const orderingOpen = orderingStatus?.open === true;
```
and replace direct `orderingStatus.open` reads with `orderingOpen`, and only show "Orders closed · Opens X" when `orderingKnown && !orderingOpen`. While `orderingKnown` is false, behave as if open (don't disable Checkout button on first paint — server gate is still authoritative).

- [ ] **Step 3: Repeat the same refactor in `src/app/checkout/page.tsx`**

Same pattern as Step 2 — replace sync `getOrderingStatus()` + 60s setInterval at lines ~222-225 with fetch-and-poll, same `orderingKnown`/`orderingOpen` guard.

- [ ] **Step 4: Run type-check + full test suite**

Run: `pnpm typecheck && pnpm test`
Expected: no new errors, all tests pass.

- [ ] **Step 5: Browser smoke (cart + checkout)**

Start dev server in background:
```bash
pnpm dev &
```
Wait for `Ready in Xms`, then use `cmux new-pane --type browser --direction right --url http://localhost:3000`, navigate to `/menu`, add a drink, open cart drawer.

Check via `cmux browser console list` and `cmux browser errors list`:
- No JS errors
- Network shows `/api/store-status` 200 with `{ open: true, nextLabel: "until 10:30pm" }` (because migration set `pos_backup_mode=true` already)
- Cart drawer Checkout button is primary (not greyed out), even if Brisbane local time is between 22:15 and 22:30

Take a screenshot: `cmux browser screenshot --out /tmp/cart-pos-backup.png`

Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add src/components/cart/CartDrawer.tsx src/app/checkout/page.tsx
git commit -m "feat(cart/checkout): poll /api/store-status (30s) for effective ordering window"
```

---

## Task 6: Web PR + push

**Files:** none (git only)

- [ ] **Step 1: Push branch and open PR**

```bash
cd ~/Github/mandys_bubble_tea-hours
git push -u origin feat/pos-backup-mode
gh pr create --title "feat: online ordering POS backup mode switch" --body "$(cat <<'EOF'
## Summary
- New \`app_settings\` KV table on Mandy web Supabase with \`pos_backup_mode\` row
- \`getEffectiveOrderingStatus()\` reads the setting (60s memo, defensive default)
- Public \`GET /api/store-status\` feeds cart/checkout UI via 30s poll
- \`/api/orders\` server gate honors the toggle
- Migration applies + flips \`pos_backup_mode\` to \`true\` immediately

Companion admin PR (toggle UI) lands separately in mandys_bubble_tea_admin.

## Test plan
- [ ] All vitest pass (store-status 9 new cases + route 2 cases)
- [ ] Type-check clean
- [ ] Browser smoke: cart shows "until 10:30pm", Checkout active outside 22:15-22:30 window
- [ ] After admin PR, toggling banner in /members flips customer cart within ~30s

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL returned. Save it for the admin-side PR cross-link.

---

## Task 7: Admin — feature branch + middleware include

**Files:**
- Modify: `src/middleware.ts`

- [ ] **Step 1: Pin admin worktree to fresh feature branch**

```bash
cd ~/Github/mandys_bubble_tea_admin
git fetch origin
git checkout -b feat/pos-backup-mode origin/main
```

- [ ] **Step 2: Add `/api/admin/settings` to PROTECTED_API_PREFIXES**

In `src/middleware.ts`, change:
```ts
const PROTECTED_API_PREFIXES = ["/api/members-stats", "/api/admin/sales-diag"];
```
to:
```ts
const PROTECTED_API_PREFIXES = [
  "/api/members-stats",
  "/api/admin/sales-diag",
  "/api/admin/settings",
];
```

- [ ] **Step 3: Commit**

```bash
git add src/middleware.ts
git commit -m "chore(middleware): protect /api/admin/settings/*"
```

---

## Task 8: Admin — `GET/PATCH /api/admin/settings/ordering` route (TDD)

**Files:**
- Create: `src/app/api/admin/settings/ordering/route.ts`
- Create: `src/app/api/admin/settings/ordering/route.test.ts`

- [ ] **Step 1: Verify admin repo has `SUPABASE_SERVICE_ROLE_KEY` env for the Mandy web project**

Run: `grep -l "SUPABASE_SERVICE_ROLE_KEY" .env.local .env 2>/dev/null && echo HAS_KEY || echo MISSING_KEY`

If MISSING: stop and ask Stan to populate `.env.local` with `SUPABASE_SERVICE_ROLE_KEY=<key for fsvtwivogyebugqhmjjy>` plus the same in Vercel admin project Production env before proceeding. Don't write a fake placeholder.

- [ ] **Step 2: Write the failing route tests**

Create `src/app/api/admin/settings/ordering/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, PATCH } from "./route";

// Mock supabase admin
const upsert = vi.fn();
const select = vi.fn();
const fromMock = vi.fn(() => ({
  select: () => ({
    eq: () => ({
      maybeSingle: select,
    }),
  }),
  upsert: (...args: unknown[]) => upsert(...args),
}));

vi.mock("@/lib/supabase-server", () => ({
  getSupabaseAdmin: () => ({ from: fromMock }),
}));

// Mock cookies() + verifySession
const verifySession = vi.fn();
vi.mock("@/lib/admin-session", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin-session")>(
    "@/lib/admin-session",
  );
  return { ...actual, verifySession: (...args: unknown[]) => verifySession(...args) };
});

function makeReq(method: "GET" | "PATCH", body?: unknown, cookie?: string): NextRequest {
  const headers = new Headers();
  if (cookie) headers.set("cookie", `mandys_admin_session=${cookie}`);
  if (body) headers.set("content-type", "application/json");
  return new NextRequest("http://localhost/api/admin/settings/ordering", {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("GET /api/admin/settings/ordering", () => {
  beforeEach(() => {
    select.mockReset();
    upsert.mockReset();
    verifySession.mockReset();
  });

  it("returns current mode + audit fields", async () => {
    verifySession.mockResolvedValue({ email: "stan@mandybubbletea.com" });
    select.mockResolvedValue({
      data: {
        value: true,
        updated_at: "2026-05-16T04:32:00Z",
        updated_by: "stan@mandybubbletea.com",
      },
      error: null,
    });
    const res = await GET(makeReq("GET", undefined, "stub"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      mode: "pos_backup",
      updated_at: "2026-05-16T04:32:00Z",
      updated_by: "stan@mandybubbletea.com",
    });
  });

  it("missing row returns mode=normal", async () => {
    verifySession.mockResolvedValue({ email: "stan@mandybubbletea.com" });
    select.mockResolvedValue({ data: null, error: null });
    const res = await GET(makeReq("GET", undefined, "stub"));
    expect(await res.json()).toMatchObject({ mode: "normal" });
  });
});

describe("PATCH /api/admin/settings/ordering", () => {
  beforeEach(() => {
    select.mockReset();
    upsert.mockReset();
    verifySession.mockReset();
  });

  it("upserts pos_backup_mode=true with admin email", async () => {
    verifySession.mockResolvedValue({ email: "stan@mandybubbletea.com" });
    upsert.mockResolvedValue({ error: null });
    const res = await PATCH(makeReq("PATCH", { mode: "pos_backup" }, "stub"));
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "pos_backup_mode",
        value: true,
        updated_by: "stan@mandybubbletea.com",
      }),
      expect.anything(),
    );
  });

  it("rejects body with invalid mode", async () => {
    verifySession.mockResolvedValue({ email: "stan@mandybubbletea.com" });
    const res = await PATCH(makeReq("PATCH", { mode: "off" }, "stub"));
    expect(res.status).toBe(400);
  });

  it("unauthorized when session invalid (middleware would block but defensive)", async () => {
    verifySession.mockResolvedValue(null);
    const res = await PATCH(makeReq("PATCH", { mode: "pos_backup" }, "bad"));
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 3: Run tests, verify they fail (route not implemented)**

Run: `pnpm test src/app/api/admin/settings/ordering/route.test.ts`
Expected: FAIL — module `./route` not found.

- [ ] **Step 4: Implement the route**

Create `src/app/api/admin/settings/ordering/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import {
  SESSION_COOKIE_NAME,
  verifySession,
} from "@/lib/admin-session";

export const dynamic = "force-dynamic";

type Mode = "normal" | "pos_backup";

async function currentAdminEmail(req: NextRequest): Promise<string | null> {
  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySession(cookie);
  return session?.email ?? null;
}

export async function GET(req: NextRequest) {
  // Middleware already blocks unauthorized; this is defensive only.
  const email = await currentAdminEmail(req);
  if (!email) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await getSupabaseAdmin()
    .from("app_settings")
    .select("value, updated_at, updated_by")
    .eq("key", "pos_backup_mode")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  const mode: Mode = data?.value === true ? "pos_backup" : "normal";
  return NextResponse.json({
    mode,
    updated_at: data?.updated_at ?? null,
    updated_by: data?.updated_by ?? null,
  });
}

export async function PATCH(req: NextRequest) {
  const email = await currentAdminEmail(req);
  if (!email) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: { mode?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const mode = body?.mode;
  if (mode !== "normal" && mode !== "pos_backup") {
    return NextResponse.json(
      { ok: false, error: "mode must be 'normal' or 'pos_backup'" },
      { status: 400 },
    );
  }

  const value = mode === "pos_backup";
  const { error } = await getSupabaseAdmin()
    .from("app_settings")
    .upsert(
      {
        key: "pos_backup_mode",
        value,
        updated_at: new Date().toISOString(),
        updated_by: email,
      },
      { onConflict: "key" },
    );

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, mode });
}
```

- [ ] **Step 5: Run tests, verify all pass**

Run: `pnpm test src/app/api/admin/settings/ordering/route.test.ts`
Expected: 5/5 pass.

- [ ] **Step 6: Type-check**

Run: `pnpm typecheck`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/admin/settings/ordering/
git commit -m "feat(api): admin GET/PATCH /api/admin/settings/ordering (HMAC session gated)"
```

---

## Task 9: Admin — `<OrderingModeBanner>` component (TDD)

**Files:**
- Create: `src/components/OrderingModeBanner.tsx`
- Create: `src/components/OrderingModeBanner.test.tsx`

- [ ] **Step 1: Confirm the admin repo's test setup supports React Testing Library**

Run: `grep -E "@testing-library/react|jsdom" package.json`
Expected: dependencies present. If missing, note in PR description and ship Banner without a unit test (rely on browser smoke in Task 11); do NOT add new deps in this plan.

- [ ] **Step 2: If RTL is present, write the failing banner test**

Create `src/components/OrderingModeBanner.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import OrderingModeBanner from "./OrderingModeBanner";

global.fetch = vi.fn();

describe("OrderingModeBanner", () => {
  beforeEach(() => {
    (global.fetch as ReturnType<typeof vi.fn>).mockReset();
  });

  it("renders the current mode and audit line", () => {
    render(
      <OrderingModeBanner
        initial={{
          mode: "pos_backup",
          updated_at: "2026-05-16T04:32:00Z",
          updated_by: "stan@mandybubbletea.com",
        }}
      />,
    );
    expect(screen.getByText(/POS 故障备用/)).toBeInTheDocument();
    expect(screen.getByText(/stan@mandybubbletea.com/)).toBeInTheDocument();
  });

  it("clicking the other radio fires PATCH", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, mode: "normal" }),
    } as Response);

    render(
      <OrderingModeBanner
        initial={{
          mode: "pos_backup",
          updated_at: "2026-05-16T04:32:00Z",
          updated_by: "stan@mandybubbletea.com",
        }}
      />,
    );
    fireEvent.click(screen.getByLabelText(/正常/));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/admin/settings/ordering",
        expect.objectContaining({ method: "PATCH" }),
      );
    });
  });
});
```

- [ ] **Step 3: Run test, verify it fails (component does not exist yet)**

Run: `pnpm test src/components/OrderingModeBanner.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Implement the component**

Create `src/components/OrderingModeBanner.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";

type Mode = "normal" | "pos_backup";

export type OrderingModeBannerProps = {
  initial: {
    mode: Mode;
    updated_at: string | null;
    updated_by: string | null;
  };
};

function formatBrisbane(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  // Brisbane = UTC+10 no DST
  const bne = new Date(d.getTime() + 10 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${bne.getUTCFullYear()}-${pad(bne.getUTCMonth() + 1)}-${pad(bne.getUTCDate())} ` +
    `${pad(bne.getUTCHours())}:${pad(bne.getUTCMinutes())}`
  );
}

export default function OrderingModeBanner({ initial }: OrderingModeBannerProps) {
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [updatedAt, setUpdatedAt] = useState(initial.updated_at);
  const [updatedBy, setUpdatedBy] = useState(initial.updated_by);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function flip(to: Mode) {
    if (to === mode) return;
    const previous = mode;
    setError(null);
    setMode(to); // optimistic
    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/settings/ordering", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: to }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await res.json();
        setUpdatedAt(new Date().toISOString());
        // updated_by we'll re-fetch on next page load; UI just shows "(you)" for now
        setUpdatedBy("(you)");
      } catch (err) {
        setMode(previous);
        setError(err instanceof Error ? err.message : "Switch failed");
      }
    });
  }

  return (
    <div className="border border-[#C43A10] rounded-lg p-4 mb-6 bg-[#FFF7EE]">
      <div className="text-sm font-semibold mb-3">线上接单模式</div>
      <div className="space-y-2">
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="radio"
            name="ordering-mode"
            value="normal"
            checked={mode === "normal"}
            onChange={() => flip("normal")}
            className="mt-1"
          />
          <div>
            <div className="text-sm">正常 (10:30am – 10:15pm)</div>
            <div className="text-xs text-gray-500">营业末 15min 不接单，让员工收尾</div>
          </div>
        </label>
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="radio"
            name="ordering-mode"
            value="pos_backup"
            checked={mode === "pos_backup"}
            onChange={() => flip("pos_backup")}
            className="mt-1"
          />
          <div>
            <div className="text-sm">POS 故障备用 (10:30am – 10:30pm)</div>
            <div className="text-xs text-gray-500">全程接单，线上当线下替补</div>
          </div>
        </label>
      </div>
      <div className="mt-3 text-xs text-gray-500">
        上次切换：{formatBrisbane(updatedAt)} by {updatedBy ?? "—"}
      </div>
      {error && (
        <div className="mt-2 text-xs text-[#C43A10]">切换失败：{error}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run test, verify it passes (skip if RTL absent — note in PR)**

Run: `pnpm test src/components/OrderingModeBanner.test.tsx`
Expected: 2/2 pass (or skipped per Step 1).

- [ ] **Step 6: Commit**

```bash
git add src/components/OrderingModeBanner.tsx
# If test file added:
# git add src/components/OrderingModeBanner.test.tsx
git commit -m "feat(banner): OrderingModeBanner component with optimistic toggle + audit line"
```

---

## Task 10: Admin — wire banner into `/members`

**Files:**
- Modify: `src/app/members/page.tsx`

- [ ] **Step 1: Read current `/members` page**

Run: `cat src/app/members/page.tsx`

Identify whether it's a server component (default) or client. If server: we'll fetch initial state server-side and pass to client banner. If client: pass `initial` as an empty fallback and let the banner fetch on mount via `useEffect` — but prefer the server path.

- [ ] **Step 2: Add server-side initial fetch + render banner above existing dashboard**

If server component, modify `src/app/members/page.tsx`. At the top of the page component:

```tsx
import OrderingModeBanner from "@/components/OrderingModeBanner";
import { getSupabaseAdmin } from "@/lib/supabase-server";

type Mode = "normal" | "pos_backup";

async function readOrderingMode(): Promise<{
  mode: Mode;
  updated_at: string | null;
  updated_by: string | null;
}> {
  try {
    const { data } = await getSupabaseAdmin()
      .from("app_settings")
      .select("value, updated_at, updated_by")
      .eq("key", "pos_backup_mode")
      .maybeSingle();
    return {
      mode: data?.value === true ? "pos_backup" : "normal",
      updated_at: data?.updated_at ?? null,
      updated_by: data?.updated_by ?? null,
    };
  } catch {
    return { mode: "normal", updated_at: null, updated_by: null };
  }
}

export default async function MembersPage() {
  const initial = await readOrderingMode();
  return (
    <div>
      <OrderingModeBanner initial={initial} />
      <MembersDashboard /* ...existing props... */ />
    </div>
  );
}
```

Adapt the JSX to whatever the existing page already renders — the banner goes **first**, then the rest. If the existing page returns a fragment or a single root, wrap with a `<div>`.

- [ ] **Step 3: Type-check + full test suite**

Run: `pnpm typecheck && pnpm test`
Expected: clean.

- [ ] **Step 4: Browser smoke**

Start admin dev server:
```bash
pnpm dev &
```
`cmux new-pane --type browser --direction right --url http://localhost:3000/members`

Sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env.local`.

Verify:
- Banner renders at top of `/members`
- Currently selected radio = "POS 故障备用" (matches migration seed)
- Audit line shows `migration-seed` (or earlier admin if test data exists)
- Click "正常" radio → optimistic flip → audit line updates to `(you)` + new timestamp
- Network tab shows `PATCH /api/admin/settings/ordering` with `200`
- Reload — banner state persists (read from DB)

Screenshot: `cmux browser screenshot --out /tmp/admin-banner.png`

Flip back to "POS 故障备用" before stopping dev server (we want production to stay in backup mode after ship).

Stop dev server.

- [ ] **Step 5: Commit**

```bash
git add src/app/members/page.tsx
git commit -m "feat(members): mount OrderingModeBanner at top of /members"
```

---

## Task 11: Admin PR + push

- [ ] **Step 1: Push admin branch + PR**

```bash
cd ~/Github/mandys_bubble_tea_admin
git push -u origin feat/pos-backup-mode
gh pr create --title "feat: POS backup mode toggle on /members" --body "$(cat <<'EOF'
## Summary
- New \`/api/admin/settings/ordering\` (GET + PATCH) — HMAC-cookie gated, writes to Mandy web Supabase \`app_settings\`
- \`<OrderingModeBanner>\` at top of \`/members\` — two-radio panel + optimistic flip + audit line
- Middleware extended to protect \`/api/admin/settings\`

Pair with web PR (see linked PR in mandys_bubble_tea).

Requires \`SUPABASE_SERVICE_ROLE_KEY\` for Mandy web project (\`fsvtwivogyebugqhmjjy\`) in admin Vercel Production env.

## Test plan
- [ ] vitest pass (route 5 cases + banner 2 if RTL present)
- [ ] Type-check clean
- [ ] Banner renders on /members, flip → PATCH → audit line updates
- [ ] Web cart reflects flip within ~30s

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Task 12: Cross-repo smoke + close

- [ ] **Step 1: Verify env**

Check Vercel admin project Production env has `SUPABASE_SERVICE_ROLE_KEY` = service-role key for `fsvtwivogyebugqhmjjy`. If missing, add it before merging admin PR — toggle will 500 otherwise.

- [ ] **Step 2: Merge both PRs**

Merge order is decoupled (web works without admin, admin requires web table). Recommended order:
1. Web PR — vercel auto-deploys → migration already applied → `/api/orders` honors backup mode → cart UI polls and shows "until 10:30pm"
2. Admin PR — vercel auto-deploys → banner appears on `/members`

- [ ] **Step 3: Production smoke**

After both Vercel deploys finish:

1. Open `https://mandybubbletea.com` in a regular browser. DevTools → Network tab. Filter `store-status`. Reload page, open cart drawer. Should see `GET /api/store-status` 200 returning `{open: true, nextLabel: "until 10:30pm"}` and a refetch every ~30s.
2. Open `https://admin.mandybubbletea.com/members`. Top banner should show "POS 故障备用" selected with `migration-seed` audit. Flip to "正常", confirm audit line updates with admin email + fresh timestamp.
3. Within ~30s of flipping admin, refresh customer cart drawer — `nextLabel` should now read `until 10:15pm`.
4. Flip admin back to "POS 故障备用" (this is the desired live state).
5. Optional Postgres double-check via `mcp__supabase__execute_sql` against `fsvtwivogyebugqhmjjy`:
   ```sql
   SELECT key, value, updated_at, updated_by FROM app_settings WHERE key='pos_backup_mode';
   ```

- [ ] **Step 4: Update DEV queue + tester handoff**

Update `~/system/DEV_QUEUE-mandys.md`:
- Move the new feature into Recently Completed with commit SHAs + PR links.

Append to `~/system/TESTER_QUEUE-mandys.md` under `Pending QA from /dev`:

```
- 2026-05-16 — <web-PR-#> + <admin-PR-#> POS backup mode toggle — TEST: ① /members 顶 banner 显示 + 切换持久化 + audit 行更新 ② 客户端 cart drawer 在 10:30pm-10:30pm 还能下单 (backup mode on) ③ 切到 "正常" 30s 内 cart UI 翻回 "until 10:15pm" ④ /api/orders 22:20 POST 在 backup mode 应该 accept (server gate)、normal mode 应该 reject — STATUS: pending
```

---

## Self-Review Notes

Spec coverage:
- Schema (spec §1) → Task 1 ✓
- `getEffectiveOrderingStatus` + memo (spec §2) → Task 2 ✓
- `GET /api/store-status` (spec §3) → Task 3 ✓
- `/api/orders` swap (spec §3) → Task 4 ✓
- Cart drawer + checkout poll (spec §3) → Task 5 ✓
- Admin GET + PATCH (spec §4) → Task 8 ✓
- `<OrderingModeBanner>` + `/members` wire (spec §4) → Tasks 9-10 ✓
- Customer copy unchanged outside hours (spec §5) → preserved by reusing `getOrderingStatus` for the off-hours / non-backup branch ✓
- Test cases (spec §Testing) → Tasks 2 (8 store-status cases), 3 (2 route cases), 8 (5 admin route cases), 9 (2 banner cases) — 17 new tests total, matches spec ✓
- Rollout (spec §Rollout) → Tasks 1, 6, 11, 12 ✓

Placeholder scan: none — every step has concrete file path, code block, or command.

Type consistency: `Mode = "normal" | "pos_backup"` used identically in admin route (Task 8) and banner (Task 9). `OrderingStatus` shape `{open, nextLabel}` unchanged from existing code, just made nullable in cart polling (Task 5).
