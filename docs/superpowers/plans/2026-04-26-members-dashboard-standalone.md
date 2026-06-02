# Members Dashboard Implementation Plan — Standalone Edition

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `admin.mandybubbletea.com` — a standalone Next.js admin app showing membership analytics (total members, web vs app split, weekly/monthly growth, registered → first-order funnel, loyalty completion). Reads from the same Supabase project + Square account as the customer-facing site, but lives in its own repo and Vercel project.

**Source spec:** `docs/superpowers/specs/2026-04-26-members-dashboard-design.md` — see "Revised Architecture (2026-04-26 PM)" section.

**Architecture:** Two repos involved. Phase A modifies the existing customer-site repo (`~/Github/mandys_bubble_tea`) to add the `signup_channel` data signal. Phases B-E build the admin app in a new repo (`~/Github/mandys_bubble_tea_admin`). Auth uses Supabase magic-link OTP scoped to the admin domain; access gated by the existing `admin_users` table (shared across both apps).

**Tech Stack:** Next.js 14 (App Router) · TypeScript · Tailwind · Supabase (`@supabase/ssr`) · Square SDK · Recharts · Vitest · Vercel.

---

## Subagent Onboarding (READ FIRST EVERY TASK)

Per `feedback_subagent_branch_pin.md`: each subagent's **Step 0** is to `cd` into the correct repo before anything else, because the controller's working directory may differ from yours.

| Phase | Working repo | Branch |
|---|---|---|
| A (signup_channel changes to customer site) | `~/Github/mandys_bubble_tea` | `feat/signup-channel` (create from `main`) |
| B (scaffold new repo) | `~/Github/mandys_bubble_tea_admin` | `main` (initial commits) |
| C (auth in new repo) | `~/Github/mandys_bubble_tea_admin` | `main` |
| D (data + UI in new repo) | `~/Github/mandys_bubble_tea_admin` | `main` |
| E (deploy + verify) | both repos | n/a |

The `~/Github/mandys_bubble_tea_admin` directory does not exist until Task B1 creates it.

---

## File Map

### In `~/Github/mandys_bubble_tea` (Phase A)

**Create:**
- `supabase/migrations/2026-04-26-signup-channel.sql`

**Modify:**
- `src/app/api/auth/complete-signup/route.ts`
- `src/components/auth/AuthProvider.tsx`

### In `~/Github/mandys_bubble_tea_admin` (Phases B-D)

**Create (all):**
- `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `.env.example`, `.gitignore`, `README.md` — scaffolded by `create-next-app`
- `vitest.config.ts`
- `src/__mocks__/server-only.ts`
- `src/lib/supabase-server.ts`
- `src/lib/supabase-browser.ts`
- `src/lib/square.ts`
- `src/lib/auth.ts`
- `src/lib/members-stats.ts`
- `src/lib/members-stats.test.ts`
- `src/middleware.ts`
- `src/app/layout.tsx` (replace generated)
- `src/app/page.tsx` (replace generated)
- `src/app/sign-in/page.tsx`
- `src/app/sign-in/SignInForm.tsx`
- `src/app/api/auth/callback/route.ts`
- `src/app/api/members-stats/route.ts`
- `src/app/members/page.tsx`
- `src/app/members/MembersDashboard.tsx`
- `src/components/KpiTile.tsx`
- `src/components/ChannelDonut.tsx`
- `src/components/MembersTrendChart.tsx`
- `src/components/FunnelBars.tsx`
- `src/components/TopCustomersTable.tsx`

---

## PHASE A — Customer-site changes (`~/Github/mandys_bubble_tea`)

Three small additive changes that the new admin app depends on. Ship these on a feature branch and merge to `main` before Phase D5+ (the admin needs the column to exist).

### Task A1: Migration — add `signup_channel` with push-token backfill

**Repo:** `~/Github/mandys_bubble_tea`
**Branch:** `feat/signup-channel` (create from `main`)
**Files:**
- Create: `supabase/migrations/2026-04-26-signup-channel.sql`

- [ ] **Step 0: Pin repo and branch**

```bash
cd ~/Github/mandys_bubble_tea
git fetch origin
git checkout -B feat/signup-channel origin/main
```

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/2026-04-26-signup-channel.sql`:

```sql
-- 2026-04-26: signup_channel column on user_profiles.
--
-- Distinguishes web-registered vs app-registered members for the
-- standalone admin dashboard at admin.mandybubbletea.com. Backfilled
-- from device_push_tokens because the column did not exist when these
-- users registered:
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

- [ ] **Step 2: Lint by eye (no local Supabase)**

This project ships migrations to prod via Supabase Studio per spec § Rollout. Confirm:
- `ADD COLUMN IF NOT EXISTS` (re-runnable)
- `DROP CONSTRAINT IF EXISTS` precedes `ADD CONSTRAINT` (re-runnable)
- `WHERE signup_channel IS NULL` (UPDATE is idempotent)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/2026-04-26-signup-channel.sql
git commit -m "db: add user_profiles.signup_channel with push-token backfill"
```

---

### Task A2: `complete-signup` route accepts `channel`

**Repo:** `~/Github/mandys_bubble_tea`
**Branch:** `feat/signup-channel`
**Files:**
- Modify: `src/app/api/auth/complete-signup/route.ts`

- [ ] **Step 0: Pin branch**

```bash
cd ~/Github/mandys_bubble_tea
git checkout feat/signup-channel
```

- [ ] **Step 1: Update Body type**

In `src/app/api/auth/complete-signup/route.ts`, change `Body` (around lines 28-32):

```typescript
type Body = {
  firstName?: unknown;
  lastName?: unknown;
  channel?: unknown;
};
```

- [ ] **Step 2: Parse and validate channel**

After the `lastName` validation (around line 67), insert:

```typescript
  const channelRaw = typeof body.channel === "string" ? body.channel : "";
  const channel: "web" | "app" | null =
    channelRaw === "web" || channelRaw === "app" ? channelRaw : null;
  // channel is optional — older clients (and the RN app pre-release)
  // do not send it. NULL is allowed in DB until Phase 2 migration.
```

- [ ] **Step 3: Persist on the upsert**

Update the upsert (around lines 139-156) to include `signup_channel`:

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

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/auth/complete-signup/route.ts
git commit -m "feat(auth): persist signup_channel in user_profiles"
```

---

### Task A3: AuthProvider sends `channel: 'web'`

**Repo:** `~/Github/mandys_bubble_tea`
**Branch:** `feat/signup-channel`
**Files:**
- Modify: `src/components/auth/AuthProvider.tsx`

- [ ] **Step 0: Pin branch**

```bash
cd ~/Github/mandys_bubble_tea
git checkout feat/signup-channel
```

- [ ] **Step 1: Update completeSignup body**

In `src/components/auth/AuthProvider.tsx` `completeSignup` callback (around lines 298-313), update the `body` line:

```typescript
        body: JSON.stringify({ firstName, lastName, channel: "web" }),
```

(Only the `body` line changes.)

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Smoke test the route locally**

```bash
npm run dev
```

In another terminal:

```bash
curl -sX POST http://localhost:3000/api/auth/complete-signup \
  -H 'Content-Type: application/json' \
  -d '{"firstName":"Test","channel":"web"}'
```

Expected: `{"ok":false,"error":"Not signed in"}` 401 (proves the new optional field doesn't break parsing).

- [ ] **Step 4: Commit**

```bash
git add src/components/auth/AuthProvider.tsx
git commit -m "feat(auth): web client tags new registrations as channel=web"
```

- [ ] **Step 5: Push branch**

```bash
git push -u origin feat/signup-channel
```

Open a PR titled `feat(auth): signup_channel data signal for admin dashboard` against `main`. Merge after the migration is applied to prod via Supabase Studio (see Phase E).

---

## PHASE B — Scaffold new admin repo (`~/Github/mandys_bubble_tea_admin`)

### Task B1: Bootstrap with `create-next-app` + initial commit

**Repo:** new — does not yet exist
**Branch:** n/a (will be `main` after init)
**Files:** all generated

- [ ] **Step 0: Confirm parent dir exists, target dir does not**

```bash
ls ~/Github
ls ~/Github/mandys_bubble_tea_admin 2>&1 | head -1
```

Expected: target dir does not exist.

- [ ] **Step 1: Run create-next-app with explicit flags**

From `~/Github`:

```bash
cd ~/Github
npx --yes create-next-app@14 mandys_bubble_tea_admin \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir \
  --import-alias "@/*" \
  --use-npm \
  --no-turbopack
```

Expected: scaffolds the new repo. May take 30-60s.

- [ ] **Step 2: Verify it runs**

```bash
cd ~/Github/mandys_bubble_tea_admin
npm run dev
```

Visit `http://localhost:3000` — should see the default Next.js page. Stop the dev server (`Ctrl+C`).

- [ ] **Step 3: Pin Node engines**

Edit `package.json`, add at top level:

```json
{
  "engines": {
    "node": ">=20"
  },
}
```

- [ ] **Step 4: Initial commit**

`create-next-app` already runs `git init` and makes a first commit. Verify and add the engines change:

```bash
cd ~/Github/mandys_bubble_tea_admin
git status
git add package.json
git commit -m "chore: pin node 20+"
git log --oneline | head -5
```

Expected: at least 2 commits — the create-next-app initial + the engines pin.

---

### Task B2: Install runtime deps

**Repo:** `~/Github/mandys_bubble_tea_admin`
**Branch:** `main`
**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 0: Pin repo**

```bash
cd ~/Github/mandys_bubble_tea_admin
```

- [ ] **Step 1: Install runtime deps**

```bash
npm install \
  @supabase/supabase-js@^2.45.0 \
  @supabase/ssr@^0.5.0 \
  square@^38.0.0 \
  recharts@^2.12.0
```

- [ ] **Step 2: Install dev deps**

```bash
npm install -D \
  vitest@^2.0.0 \
  @vitest/ui@^2.0.0 \
  @types/node@^20.0.0
```

- [ ] **Step 3: Add scripts to package.json**

Edit `package.json` `scripts` block to include:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 4: Run typecheck to confirm setup**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install supabase, square, recharts, vitest"
```

---

### Task B3: Vitest config + server-only mock

**Repo:** `~/Github/mandys_bubble_tea_admin`
**Branch:** `main`
**Files:**
- Create: `vitest.config.ts`
- Create: `src/__mocks__/server-only.ts`
- Create: `.env.test`

- [ ] **Step 0: Pin repo**

```bash
cd ~/Github/mandys_bubble_tea_admin
```

- [ ] **Step 1: Write vitest.config.ts**

```typescript
import { config } from 'dotenv';
config({ path: '.env.test' });
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      'server-only': path.resolve(__dirname, 'src/__mocks__/server-only.ts'),
    },
  },
});
```

- [ ] **Step 2: Write the server-only stub**

Create `src/__mocks__/server-only.ts`:

```typescript
// Vitest stub: the real `server-only` package throws if imported in a
// client bundle. Tests import server modules directly, so we no-op it.
export {};
```

- [ ] **Step 3: Write .env.test placeholder**

Create `.env.test`:

```
# Test-only fixtures. Real values live in Vercel env vars.
NEXT_PUBLIC_SUPABASE_URL=https://test.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=test-anon-key
SUPABASE_SERVICE_ROLE_KEY=test-service-key
SQUARE_ACCESS_TOKEN=test-square-token
SQUARE_LOCATION_ID=L_TEST
SQUARE_ENV=sandbox
```

Add `.env.test` to `.gitignore`:

```bash
printf "\n.env.test\n" >> .gitignore
```

- [ ] **Step 4: Add a smoke test to confirm vitest works**

Create `src/lib/.gitkeep` (placeholder so we have a place for the first test):

```bash
mkdir -p src/lib
touch src/lib/.gitkeep
```

Create `src/lib/smoke.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('vitest setup', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run vitest**

```bash
npm test
```

Expected: 1 passing test.

- [ ] **Step 6: Delete the smoke test (we'll have real tests soon)**

```bash
rm src/lib/smoke.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts src/__mocks__/server-only.ts .gitignore src/lib/.gitkeep
git commit -m "chore: vitest config + server-only mock"
```

---

### Task B4: Supabase + Square clients

**Repo:** `~/Github/mandys_bubble_tea_admin`
**Branch:** `main`
**Files:**
- Create: `src/lib/supabase-server.ts`
- Create: `src/lib/supabase-browser.ts`
- Create: `src/lib/square.ts`
- Create: `.env.example`

- [ ] **Step 0: Pin repo**

```bash
cd ~/Github/mandys_bubble_tea_admin
```

- [ ] **Step 1: Write supabase-server.ts (service role + cookie-based)**

Create `src/lib/supabase-server.ts`:

```typescript
import "server-only";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!SUPABASE_URL) throw new Error("NEXT_PUBLIC_SUPABASE_URL not set");

// Service-role client. Bypasses RLS. Use ONLY in trusted server code
// (route handlers, server components) — never expose to the browser.
export function getSupabaseAdmin() {
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Cookie-bound anon client for server components / route handlers that
// need the *current user's* session.
export async function getSupabaseRoute() {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options as CookieOptions);
          }
        } catch {
          // Server components can't set cookies; route handlers can.
          // Failing silently here is consistent with @supabase/ssr docs.
        }
      },
    },
  });
}
```

- [ ] **Step 2: Write supabase-browser.ts**

Create `src/lib/supabase-browser.ts`:

```typescript
"use client";
import { createBrowserClient } from "@supabase/ssr";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export function getSupabaseBrowser() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
```

- [ ] **Step 3: Write square.ts**

Create `src/lib/square.ts`:

```typescript
import "server-only";
import { SquareClient, SquareEnvironment } from "square";

const ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN ?? "";
const ENV = process.env.SQUARE_ENV === "production"
  ? SquareEnvironment.Production
  : SquareEnvironment.Sandbox;

if (!ACCESS_TOKEN) {
  // Don't throw at import time — vitest tests for unrelated lib code
  // would explode. Throw on first method access instead.
  console.warn("[square] SQUARE_ACCESS_TOKEN not set");
}

export const squareClient = new SquareClient({
  token: ACCESS_TOKEN,
  environment: ENV,
});
```

- [ ] **Step 4: Write .env.example**

Create `.env.example`:

```
# Supabase — same project as the customer site (mandys_bubble_tea).
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Square — same credentials as the customer site.
SQUARE_ACCESS_TOKEN=
SQUARE_LOCATION_ID=
SQUARE_ENV=production
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/supabase-server.ts src/lib/supabase-browser.ts src/lib/square.ts .env.example
git commit -m "feat: supabase + square client setup"
```

---

## PHASE C — Auth in admin repo

### Task C1: `getAuthedAdmin()` helper

**Repo:** `~/Github/mandys_bubble_tea_admin`
**Branch:** `main`
**Files:**
- Create: `src/lib/auth.ts`
- Create: `src/lib/auth.test.ts`

- [ ] **Step 0: Pin repo**

```bash
cd ~/Github/mandys_bubble_tea_admin
```

- [ ] **Step 1: Write the helper**

Create `src/lib/auth.ts`:

```typescript
import "server-only";
import { getSupabaseAdmin, getSupabaseRoute } from "./supabase-server";

export type AuthedAdmin = {
  userId: string;
  email: string | null;
};

/**
 * Returns the authenticated admin user, or null if not signed in or not
 * in the admin_users allow-list. Server components / route handlers
 * should redirect / 404 on null.
 */
export async function getAuthedAdmin(): Promise<AuthedAdmin | null> {
  const ssr = await getSupabaseRoute();
  const { data: { user } } = await ssr.auth.getUser();
  if (!user) return null;

  const admin = getSupabaseAdmin();
  const { data: row } = await admin
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!row) return null;

  return { userId: user.id, email: user.email ?? null };
}
```

- [ ] **Step 2: Write tests**

Create `src/lib/auth.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockAdmin = { from: vi.fn() };
const mockSsr = { auth: { getUser: vi.fn() } };

vi.mock("./supabase-server", () => ({
  getSupabaseAdmin: () => mockAdmin,
  getSupabaseRoute: async () => mockSsr,
}));

import { getAuthedAdmin } from "./auth";

function maybeSingleResult(value: unknown) {
  return {
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: value, error: null }),
      }),
    }),
  };
}

describe("getAuthedAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no session", async () => {
    mockSsr.auth.getUser.mockResolvedValue({ data: { user: null } });
    const result = await getAuthedAdmin();
    expect(result).toBeNull();
  });

  it("returns null when user is not in admin_users", async () => {
    mockSsr.auth.getUser.mockResolvedValue({
      data: { user: { id: "u1", email: "a@b.com" } },
    });
    mockAdmin.from.mockReturnValue(maybeSingleResult(null));
    const result = await getAuthedAdmin();
    expect(result).toBeNull();
  });

  it("returns the admin when allowlisted", async () => {
    mockSsr.auth.getUser.mockResolvedValue({
      data: { user: { id: "u1", email: "a@b.com" } },
    });
    mockAdmin.from.mockReturnValue(maybeSingleResult({ user_id: "u1" }));
    const result = await getAuthedAdmin();
    expect(result).toEqual({ userId: "u1", email: "a@b.com" });
  });
});
```

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: 3 passing tests.

- [ ] **Step 4: Commit**

```bash
git add src/lib/auth.ts src/lib/auth.test.ts
git commit -m "feat(auth): getAuthedAdmin helper + tests"
```

---

### Task C2: Middleware redirects unauthenticated requests

**Repo:** `~/Github/mandys_bubble_tea_admin`
**Branch:** `main`
**Files:**
- Create: `src/middleware.ts`

- [ ] **Step 0: Pin repo**

```bash
cd ~/Github/mandys_bubble_tea_admin
```

- [ ] **Step 1: Write middleware**

Create `src/middleware.ts`:

```typescript
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = ["/members"];
const PROTECTED_API_PREFIXES = ["/api/members-stats"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const needsAuth =
    PROTECTED_PREFIXES.some((p) => pathname.startsWith(p)) ||
    PROTECTED_API_PREFIXES.some((p) => pathname.startsWith(p));
  if (!needsAuth) return NextResponse.next();

  const res = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            res.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );
    }
    const signIn = req.nextUrl.clone();
    signIn.pathname = "/sign-in";
    signIn.searchParams.set("next", pathname);
    return NextResponse.redirect(signIn);
  }
  return res;
}

export const config = {
  // Run middleware on all paths except Next.js internals + static.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/middleware.ts
git commit -m "feat(auth): middleware gates /members and /api/members-stats"
```

---

### Task C3: Sign-in page (magic-link OTP)

**Repo:** `~/Github/mandys_bubble_tea_admin`
**Branch:** `main`
**Files:**
- Create: `src/app/sign-in/page.tsx`
- Create: `src/app/sign-in/SignInForm.tsx`
- Create: `src/app/api/auth/callback/route.ts`
- Replace: `src/app/page.tsx` (default-generated)
- Replace: `src/app/layout.tsx` (default-generated)

- [ ] **Step 0: Pin repo**

```bash
cd ~/Github/mandys_bubble_tea_admin
```

- [ ] **Step 1: Replace src/app/layout.tsx with admin-themed shell**

Replace `src/app/layout.tsx` contents:

```tsx
import "./globals.css";

export const metadata = {
  title: "Mandy's Admin",
  description: "Internal dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-50 text-zinc-900">{children}</body>
    </html>
  );
}
```

- [ ] **Step 2: Replace src/app/page.tsx with a redirect**

Replace `src/app/page.tsx` contents:

```tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/members");
}
```

- [ ] **Step 3: Write the sign-in page**

Create `src/app/sign-in/page.tsx`:

```tsx
import { Suspense } from "react";
import { SignInForm } from "./SignInForm";

export const dynamic = "force-dynamic";

export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <h1 className="mb-1 text-2xl font-bold">Mandy's Admin</h1>
      <p className="mb-6 text-sm text-zinc-600">
        Enter your email — we'll send you a 6-digit code.
      </p>
      <Suspense>
        <SignInForm />
      </Suspense>
    </main>
  );
}
```

- [ ] **Step 4: Write the sign-in form (client)**

Create `src/app/sign-in/SignInForm.tsx`:

```tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

type Stage =
  | { kind: "email" }
  | { kind: "otp"; email: string };

export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/members";

  const [stage, setStage] = useState<Stage>({ kind: "email" });
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const supabase = getSupabaseBrowser();
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { shouldCreateUser: false },
      });
      if (error) throw error;
      setStage({ kind: "otp", email: email.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (stage.kind !== "otp") return;
    setError(null);
    setLoading(true);
    try {
      const supabase = getSupabaseBrowser();
      const { error } = await supabase.auth.verifyOtp({
        email: stage.email,
        token: otp.trim(),
        type: "email",
      });
      if (error) throw error;
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  if (stage.kind === "email") {
    return (
      <form onSubmit={handleSendOtp} className="space-y-3">
        <input
          type="email"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-md border border-black/15 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? "Sending…" : "Send code"}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    );
  }

  return (
    <form onSubmit={handleVerifyOtp} className="space-y-3">
      <p className="text-sm text-zinc-700">
        Code sent to <strong>{stage.email}</strong>
      </p>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        required
        autoFocus
        value={otp}
        onChange={(e) => setOtp(e.target.value)}
        placeholder="123456"
        className="w-full rounded-md border border-black/15 px-3 py-2 text-center text-xl tracking-widest"
      />
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {loading ? "Verifying…" : "Verify"}
      </button>
      <button
        type="button"
        onClick={() => setStage({ kind: "email" })}
        className="w-full text-xs text-zinc-500 underline"
      >
        Use a different email
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
```

- [ ] **Step 5: Write the auth callback handler**

Create `src/app/api/auth/callback/route.ts`:

```typescript
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseRoute } from "@/lib/supabase-server";

// Handles email-link callbacks (?code=...&next=...). The OTP-paste
// flow doesn't hit this route — Supabase verifyOtp sets cookies via
// the browser client. This is here for the magic-link variant.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/members";
  if (code) {
    const supabase = await getSupabaseRoute();
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL(next, req.url));
}
```

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Smoke test locally**

```bash
npm run dev
```

Visit `http://localhost:3000/sign-in` — should render the email form (no errors). Visit `http://localhost:3000/members` — should redirect to `/sign-in?next=/members`.

Stop the dev server.

- [ ] **Step 8: Commit**

```bash
git add src/app/layout.tsx src/app/page.tsx src/app/sign-in/page.tsx src/app/sign-in/SignInForm.tsx src/app/api/auth/callback/route.ts
git commit -m "feat(auth): magic-link sign-in page + callback"
```

---

## PHASE D — Data + UI in admin repo

### Task D1: members-stats lib (Supabase KPIs + trend) — TDD

**Repo:** `~/Github/mandys_bubble_tea_admin`
**Branch:** `main`
**Files:**
- Create: `src/lib/members-stats.ts`
- Create: `src/lib/members-stats.test.ts`

- [ ] **Step 0: Pin repo**

```bash
cd ~/Github/mandys_bubble_tea_admin
```

- [ ] **Step 1: Write types and Supabase-only helpers**

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

const BRISBANE_OFFSET_MIN = 10 * 60;

function brisbaneNow(): Date {
  return new Date(Date.now() + BRISBANE_OFFSET_MIN * 60 * 1000);
}

function startOfBrisbaneMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, -10, 0, 0));
}

function startOfBrisbaneWeek(d: Date): Date {
  const dow = d.getUTCDay();
  const daysSinceMonday = (dow + 6) % 7;
  return new Date(Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() - daysSinceMonday,
    -10, 0, 0,
  ));
}

function pct(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function deltaPct(curr: number, prev: number): number | null {
  if (prev === 0) return curr === 0 ? 0 : null;
  return Math.round(((curr - prev) / prev) * 1000) / 10;
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
  const { count, error } = await admin
    .schema("auth")
    .from("users")
    .select("id", { count: "exact", head: true })
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString());
  if (error) throw new Error(`fetchNewMembers: ${error.message}`);
  return count ?? 0;
}

async function fetchTrend(
  days: number,
): Promise<{ date: string; web: number; app: number; unknown: number }[]> {
  const admin = getSupabaseAdmin();
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

  const { data: profiles, error: pErr } = await admin
    .from("user_profiles")
    .select("user_id, signup_channel");
  if (pErr) throw new Error(`fetchTrend (profiles): ${pErr.message}`);
  const channelById = new Map<string, string | null>(
    (profiles ?? []).map((p) => [
      (p as { user_id: string }).user_id,
      (p as { signup_channel: string | null }).signup_channel,
    ]),
  );

  const { data: users, error: uErr } = await admin
    .schema("auth")
    .from("users")
    .select("id, created_at")
    .gte("created_at", since);
  if (uErr) throw new Error(`fetchTrend (users): ${uErr.message}`);

  const buckets = new Map<string, { web: number; app: number; unknown: number }>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 3600 * 1000);
    buckets.set(d.toISOString().slice(0, 10), { web: 0, app: 0, unknown: 0 });
  }

  for (const u of (users ?? []) as { id: string; created_at: string }[]) {
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
      // Square-side fields populated in Task D2.
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
    topCustomers: [],
  };
}
```

- [ ] **Step 2: Write tests**

Create `src/lib/members-stats.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockAdmin = {
  from: vi.fn(),
  schema: vi.fn(() => mockAdmin),
};
vi.mock("./supabase-server", () => ({
  getSupabaseAdmin: () => mockAdmin,
}));

import { getMembersStats } from "./members-stats";

function chainable(payload: { data?: unknown; count?: number; error?: unknown }) {
  const proxy: Record<string, unknown> = new Proxy({}, {
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
        return chainable({ data: [], count: 0, error: null });
      }
      return chainable({ data: [], error: null });
    });

    const stats = await getMembersStats();
    expect(stats.kpis.totalMembers).toBe(4);
    expect(stats.kpis.web.count).toBe(2);
    expect(stats.kpis.app.count).toBe(1);
    expect(stats.kpis.unknown.count).toBe(1);
    expect(stats.kpis.web.pct).toBe(50);
  });

  it("returns 0% for empty membership", async () => {
    mockAdmin.from.mockImplementation(() =>
      chainable({ data: [], count: 0, error: null }),
    );
    const stats = await getMembersStats();
    expect(stats.kpis.totalMembers).toBe(0);
    expect(stats.kpis.web.pct).toBe(0);
  });

  it("trend has exactly 90 daily buckets in chronological order", async () => {
    mockAdmin.from.mockImplementation(() =>
      chainable({ data: [], count: 0, error: null }),
    );
    const stats = await getMembersStats();
    expect(stats.trend).toHaveLength(90);
    const first = new Date(stats.trend[0].date).getTime();
    const last = new Date(stats.trend[89].date).getTime();
    expect(last).toBeGreaterThan(first);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: 3 passing tests in `members-stats.test.ts` + 3 from `auth.test.ts` = 6 total.

- [ ] **Step 4: Commit**

```bash
git add src/lib/members-stats.ts src/lib/members-stats.test.ts
git commit -m "feat: members-stats lib (Supabase KPIs + trend)"
```

---

### Task D2: members-stats lib — Square layer

**Repo:** `~/Github/mandys_bubble_tea_admin`
**Branch:** `main`
**Files:**
- Modify: `src/lib/members-stats.ts`
- Modify: `src/lib/members-stats.test.ts`

- [ ] **Step 0: Pin repo**

```bash
cd ~/Github/mandys_bubble_tea_admin
```

- [ ] **Step 1: Add Square import and helpers to the lib**

In `src/lib/members-stats.ts`, add to the top imports:

```typescript
import { squareClient } from "./square";
```

Add these helpers BELOW the existing helpers and ABOVE `getMembersStats`:

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
  const tail = e164.slice(-3);
  return `+61 4xx xxx ${tail}`;
}

async function fetchTopCustomers(profiles: ProfileRow[]): Promise<TopCustomer[]> {
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
          lastOrderAt: null,
        });
      } catch {
        // Skip individual failures.
      }
    }),
  );

  return enriched
    .sort((a, b) => b.lifetimeSpendCents - a.lifetimeSpendCents)
    .slice(0, 10);
}
```

- [ ] **Step 2: Wire Square helpers into `getMembersStats`**

Locate the section in `getMembersStats()` after `const trend = await fetchTrend(90);` and append:

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

- [ ] **Step 3: Add tests for Square layer**

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
              first_name: "A", last_name: null, signup_channel: "web",
            },
            {
              user_id: "u2",
              square_customer_id: "C2",
              phone_e164: "+61400000002",
              first_name: "B", last_name: null, signup_channel: "app",
            },
            {
              user_id: "u3",
              square_customer_id: "C3",
              phone_e164: "+61400000003",
              first_name: "C", last_name: null, signup_channel: "web",
            },
          ],
          error: null,
        });
      }
      if (table === "users") {
        return chainable({ data: [], count: 0, error: null });
      }
      return chainable({ data: [], error: null });
    });

    (squareClient.orders.search as ReturnType<typeof vi.fn>).mockResolvedValue({
      orders: [
        { customerId: "C1" },
        { customerId: "C1" },
        { customerId: "C2" },
      ],
      cursor: undefined,
    });
    (squareClient.loyalty.accounts.search as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ loyaltyAccounts: [], cursor: undefined });
    (squareClient.loyalty.accounts.searchEvents as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ events: [], cursor: undefined });
    (squareClient.customers.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      customer: { lifetimeSpendMoney: { amount: 0n }, totalSpendCount: 0n },
    });

    const stats = await getMembersStats();
    expect(stats.kpis.ordered.count).toBe(2);
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
        return chainable({ data: [], count: 0, error: null });
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
    expect(stats.kpis.loyalty.balanceGte9).toBe(1);
    expect(stats.kpis.loyalty.withReward).toBe(1);
  });
});
```

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: 5 passing in members-stats + 3 from auth = 8 total.

- [ ] **Step 5: Commit**

```bash
git add src/lib/members-stats.ts src/lib/members-stats.test.ts
git commit -m "feat: members-stats Square layer (orders, loyalty, top customers)"
```

---

### Task D3: API route `/api/members-stats`

**Repo:** `~/Github/mandys_bubble_tea_admin`
**Branch:** `main`
**Files:**
- Create: `src/app/api/members-stats/route.ts`

- [ ] **Step 0: Pin repo**

```bash
cd ~/Github/mandys_bubble_tea_admin
```

- [ ] **Step 1: Write the route**

Create `src/app/api/members-stats/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { getAuthedAdmin } from "@/lib/auth";
import { getMembersStats } from "@/lib/members-stats";

export const revalidate = 300;

export async function GET() {
  // Middleware already gates the path on session presence; we re-check
  // admin_users membership here as a defense-in-depth layer.
  const admin = await getAuthedAdmin();
  if (!admin) {
    return NextResponse.json(
      { ok: false, error: "Forbidden" },
      { status: 403 },
    );
  }

  try {
    const stats = await getMembersStats();
    return NextResponse.json({ ok: true, stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/members-stats]", message);
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

- [ ] **Step 3: Smoke test the route locally**

```bash
npm run dev
```

In another terminal:

```bash
curl -i http://localhost:3000/api/members-stats
```

Expected: `HTTP/1.1 401 Unauthorized` (middleware blocks unauth).

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/members-stats/route.ts
git commit -m "feat: /api/members-stats endpoint"
```

---

### Task D4: KpiTile component

**Repo:** `~/Github/mandys_bubble_tea_admin`
**Branch:** `main`
**Files:**
- Create: `src/components/KpiTile.tsx`

- [ ] **Step 0: Pin repo**

```bash
cd ~/Github/mandys_bubble_tea_admin
```

- [ ] **Step 1: Write the component**

Create `src/components/KpiTile.tsx`:

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
    : trend.deltaPct > 0 ? "▲" : trend.deltaPct < 0 ? "▼" : "→";
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
      {subtitle && <p className="mt-1 text-xs text-zinc-600">{subtitle}</p>}
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
git add src/components/KpiTile.tsx
git commit -m "feat: KpiTile component"
```

---

### Task D5: ChannelDonut chart

**Repo:** `~/Github/mandys_bubble_tea_admin`
**Branch:** `main`
**Files:**
- Create: `src/components/ChannelDonut.tsx`

- [ ] **Step 0: Pin repo**

```bash
cd ~/Github/mandys_bubble_tea_admin
```

- [ ] **Step 1: Write the component**

Create `src/components/ChannelDonut.tsx`:

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
          <span key={entry.channel} className="flex items-center gap-1 text-zinc-700">
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
git add src/components/ChannelDonut.tsx
git commit -m "feat: ChannelDonut chart"
```

---

### Task D6: MembersTrendChart

**Repo:** `~/Github/mandys_bubble_tea_admin`
**Branch:** `main`
**Files:**
- Create: `src/components/MembersTrendChart.tsx`

- [ ] **Step 0: Pin repo**

```bash
cd ~/Github/mandys_bubble_tea_admin
```

- [ ] **Step 1: Write the component**

Create `src/components/MembersTrendChart.tsx`:

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
            <Line type="monotone" dataKey="web" stroke="#C43A10" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="app" stroke="#1F4FE3" dot={false} strokeWidth={2} />
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
git add src/components/MembersTrendChart.tsx
git commit -m "feat: MembersTrendChart"
```

---

### Task D7: FunnelBars

**Repo:** `~/Github/mandys_bubble_tea_admin`
**Branch:** `main`
**Files:**
- Create: `src/components/FunnelBars.tsx`

- [ ] **Step 0: Pin repo**

```bash
cd ~/Github/mandys_bubble_tea_admin
```

- [ ] **Step 1: Write the component**

Create `src/components/FunnelBars.tsx`:

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
            <YAxis type="category" dataKey="stage" width={140} tick={{ fontSize: 11 }} />
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
git add src/components/FunnelBars.tsx
git commit -m "feat: FunnelBars chart"
```

---

### Task D8: TopCustomersTable

**Repo:** `~/Github/mandys_bubble_tea_admin`
**Branch:** `main`
**Files:**
- Create: `src/components/TopCustomersTable.tsx`

- [ ] **Step 0: Pin repo**

```bash
cd ~/Github/mandys_bubble_tea_admin
```

- [ ] **Step 1: Write the component**

Create `src/components/TopCustomersTable.tsx`:

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
                  <td className="py-2 pr-3 font-medium text-zinc-900">{c.name}</td>
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
git add src/components/TopCustomersTable.tsx
git commit -m "feat: TopCustomersTable"
```

---

### Task D9: Dashboard page wiring

**Repo:** `~/Github/mandys_bubble_tea_admin`
**Branch:** `main`
**Files:**
- Create: `src/app/members/page.tsx`
- Create: `src/app/members/MembersDashboard.tsx`

- [ ] **Step 0: Pin repo**

```bash
cd ~/Github/mandys_bubble_tea_admin
```

- [ ] **Step 1: Write the client charts wrapper**

Create `src/app/members/MembersDashboard.tsx`:

```tsx
"use client";

import { ChannelDonut } from "@/components/ChannelDonut";
import { FunnelBars } from "@/components/FunnelBars";
import { MembersTrendChart } from "@/components/MembersTrendChart";
import type { MembersStats } from "@/lib/members-stats";

export function MembersDashboardCharts({ stats }: { stats: MembersStats }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <MembersTrendChart data={stats.trend} />
      <ChannelDonut data={stats.channelDistribution} />
      <FunnelBars data={stats.funnel} />
    </div>
  );
}
```

- [ ] **Step 2: Write the page**

Create `src/app/members/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { KpiTile } from "@/components/KpiTile";
import { TopCustomersTable } from "@/components/TopCustomersTable";
import { getAuthedAdmin } from "@/lib/auth";
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
  const admin = await getAuthedAdmin();
  if (!admin) notFound();

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

- [ ] **Step 4: Run lint and tests**

```bash
npm run lint
npm test
```

Expected: lint PASS, all 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/members/page.tsx src/app/members/MembersDashboard.tsx
git commit -m "feat: members dashboard page wiring"
```

---

## PHASE E — Deploy + verify

### Task E1: GitHub repo + Vercel project + env vars

**Repo:** `~/Github/mandys_bubble_tea_admin`
**Branch:** `main`
**Files:** none

This task requires browser interaction (Vercel UI) and the user's GitHub credentials. **The implementer subagent SHOULD NOT push to GitHub or create the Vercel project autonomously** — instead, output the exact commands and the user-facing checklist for the operator to run.

- [ ] **Step 0: Pin repo**

```bash
cd ~/Github/mandys_bubble_tea_admin
```

- [ ] **Step 1: Verify build succeeds locally**

```bash
npm run build
```

Expected: build PASS. Fix any errors before proceeding.

- [ ] **Step 2: Output the operator runbook**

The implementer subagent writes this checklist to `README.md` for the operator (Stan) to follow manually:

Replace `README.md` with:

```markdown
# Mandy's Admin Dashboard

Standalone Next.js admin app at `admin.mandybubbletea.com`. Reads from the same Supabase + Square account as the customer site (`mandys_bubble_tea`).

## Local dev

```bash
cp .env.example .env.local
# Fill in .env.local with the same values as ~/Github/mandys_bubble_tea/.env.local
npm install
npm run dev
```

Visit http://localhost:3000 → redirects to /members → middleware redirects to /sign-in.

## Tests

```bash
npm test
npm run typecheck
npm run lint
```

## Deploy (one-time setup)

### 1. Push to GitHub

```bash
gh repo create mandys_bubble_tea_admin --private --source=. --remote=origin --push
```

### 2. Create Vercel project

In Vercel dashboard:
1. Add New → Project → Import the GitHub repo
2. Framework: Next.js (auto-detected)
3. Root directory: `./`
4. Environment variables (Production scope, all required):
   - `NEXT_PUBLIC_SUPABASE_URL` — copy from main project
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — copy from main project
   - `SUPABASE_SERVICE_ROLE_KEY` — copy from main project
   - `SQUARE_ACCESS_TOKEN` — copy from main project
   - `SQUARE_LOCATION_ID` — copy from main project
   - `SQUARE_ENV=production`
5. Deploy. First deploy lives at `mandys-bubble-tea-admin.vercel.app`.

### 3. Custom domain `admin.mandybubbletea.com`

In Vercel project Settings → Domains:
1. Add `admin.mandybubbletea.com`
2. Vercel shows the required CNAME (typically `cname.vercel-dns.com`)
3. At the domain registrar (where mandybubbletea.com is registered), add a CNAME:
   - Name: `admin`
   - Value: `cname.vercel-dns.com`
   - TTL: default
4. Wait for DNS propagation (usually <5min, up to 48h). Vercel auto-provisions TLS once verified.

### 4. Apply Supabase migration (if not already)

Confirm the Phase A migration ran in production Supabase:

```sql
SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'user_profiles' AND column_name = 'signup_channel';
```

Expected: 1 row, `is_nullable = YES`.

If not, run `supabase/migrations/2026-04-26-signup-channel.sql` from the customer-site repo via Supabase Studio SQL Editor.

### 5. Grant yourself admin access

```sql
INSERT INTO public.admin_users (user_id, role)
VALUES ('<your auth.users.id>', 'admin')
ON CONFLICT (user_id) DO NOTHING;
```

Find your `user_id` in Supabase Studio → Authentication → Users.

### 6. Enable Email-OTP in Supabase

In Supabase Studio → Authentication → Providers → Email:
1. Confirm **Email OTP** is enabled (default in newer projects).
2. Confirm "Enable email confirmations" works for your domain.
3. Customize the email template (optional).

### 7. Verify

Visit https://admin.mandybubbletea.com → /members → /sign-in → enter your email → paste the 6-digit code → see the dashboard.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: deploy + setup runbook"
```

---

### Task E2: Operator-driven deploy steps (manual)

**Files:** none — this task is performed by Stan, not by a subagent.

The implementer subagent for this task should produce a brief summary message confirming:
- Phase D9 has been merged / committed
- Build succeeds locally
- README.md contains the runbook

And then return DONE_WITH_CONCERNS noting that the actual deployment requires manual operator action per the README. The controller (you) will surface this to the user.

- [ ] **Step 1: Confirm prerequisites**

```bash
cd ~/Github/mandys_bubble_tea_admin
npm run build && npm test && npm run typecheck && npm run lint
```

Expected: all four PASS.

- [ ] **Step 2: Operator action (Stan, not a subagent)**

Follow the steps in `README.md` § Deploy. Once `https://admin.mandybubbletea.com/members` shows the dashboard with real numbers, this task is complete.

---

### Task E3: Final smoke verification

**Files:** none

Once deployed, the operator (Stan) verifies the page end-to-end. Subagents cannot do this.

- [ ] **Step 1: Sign in flow**

In a fresh browser session, visit `https://admin.mandybubbletea.com`. Confirm:
- Redirect to `/sign-in`
- Email + OTP flow works
- After OTP, redirect to `/members`
- Page renders 8 KPI tiles + 3 charts + Top 10 table
- "As of X minutes ago" timestamp present
- No console errors (Cmd+Opt+J in Chrome)

- [ ] **Step 2: Cross-check numbers against Square Dashboard**

- Total members ≈ count of customers in Square (Customers tab) that have a phone number
- Loyalty 9-of-9 ≈ Square Loyalty Reports for the same period
- Top 10 customers names + phone last digits ≈ Square's Top customers report

If any number is off by more than 5%, file a bug — likely a Brisbane TZ edge case or a Square pagination cap.

- [ ] **Step 3: Phase A merge + signup verification**

If not done already, merge `feat/signup-channel` PR in the customer-site repo. Wait for Vercel deploy. Then on the live customer site:
1. Register a new test account via web sign-up
2. In Supabase Studio: `SELECT signup_channel FROM user_profiles WHERE phone_e164 = '<test phone>';`
3. Expected: `'web'`
4. Refresh the admin dashboard — total members count should increment by 1, web count by 1.

---

## Out of scope (do not implement)

- "Active" / "dormant" cohort breakdowns — owner asked to skip
- SKU / modifier-combination revenue analytics
- Outbound messaging (push, SMS, email)
- Order management actions (refund, edit, cancel)
- Background pre-aggregation cron — only if 5-min ISR proves too slow
- Phase 2 NOT NULL migration on `signup_channel` — separate task in DEV_QUEUE after RN release ships
- RN app `channel: 'app'` change — handled in `~/Github/mandys_bubble_tea_app` separately, see customer-site `docs/superpowers/runbooks/members-dashboard-rollout.md` (created in original plan, still relevant)
