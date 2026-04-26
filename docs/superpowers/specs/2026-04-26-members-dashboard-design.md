# Members Dashboard — Design

**Date:** 2026-04-26
**Owner:** Stan
**Status:** Approved (brainstorming) — pending implementation plan

## Goal

Give Mandy a single admin page that answers "how is the membership base growing, and what's the web vs app split" without logging into Square Dashboard. First slice intentionally narrow: registration & loyalty headline numbers only — no operational actions, no SKU analytics.

## Why

- Square's Seller Dashboard does not cleanly distinguish web-registered vs app-registered customers; that question is core to deciding where to push marketing budget.
- The project already enforces "must register to order" at three layers (`src/app/checkout/page.tsx:86-89` client gate, `src/app/api/orders/route.ts:80-83` server gate, `src/app/api/auth/complete-signup/route.ts:170-183` Square + Loyalty enrollment). So `auth.users` row count is a reliable proxy for "members" — no guest-checkout edge case to handle.
- Existing `/admin` framework already has auth (`src/app/admin/layout.tsx:1-19` checks `admin_users` table), so this is an additive page, not a new system.

## Non-Goals (explicit YAGNI)

- Active / dormant user cohort breakdowns (deferred — owner asked to skip)
- SKU / modifier-combination revenue analytics
- Outbound messaging (push, SMS, email)
- Order management actions (refund, edit, cancel)
- Complaint volume, surcharge revenue, printer health (separate dashboards)

---

## Architecture

### Page location

- New route: `src/app/admin/members/page.tsx`
- Wrapped automatically by the existing `src/app/admin/layout.tsx`, which enforces:
  1. Supabase session present (else redirect `/`)
  2. `admin_users` row exists for `user.id` (else `notFound()`)
- Add Stan's `auth.users.id` to `admin_users` via Supabase Studio one-off insert (no migration needed, table already exists).

### Data sources

| Source | Used for |
|---|---|
| `auth.users` (Supabase) | Member counts, registration timestamps, weekly/monthly trend |
| `user_profiles` (Supabase, new column `signup_channel`) | Web vs App split |
| `device_push_tokens` (Supabase) | One-time backfill of `signup_channel` for existing users |
| Square Customers API | Lifetime spend / order count for Top-10 list |
| Square Loyalty API | Stars balance, completed-9 count, available rewards |
| Square Loyalty Events API | Reward-redeem count for current month |
| Square Orders API | First-order conversion (registered → has ≥1 order, registered → has ≥2 orders) |

### Caching

- First version: per-request fetch with Next.js `revalidate: 300` (5-minute ISR). Acceptable because Mandy will check this maybe a few times per day.
- If Square API latency makes the page feel slow (>3s), Phase 2 adds a Vercel cron that pre-aggregates into a `members_dashboard_snapshot` table every 15 min and the page reads only that table. Not in scope for v1.

---

## Schema Change

### Migration `supabase/migrations/2026-04-26-signup-channel.sql`

```sql
-- 1. Add the column (nullable initially so backfill can run before constraint).
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS signup_channel TEXT;

-- 2. Backfill existing rows using device_push_tokens as proxy:
--    has any push token  → 'app' (definitely opened the app at least once)
--    no push token       → 'web' (assumed; cannot be proven)
UPDATE public.user_profiles up
SET signup_channel = CASE
  WHEN EXISTS (
    SELECT 1 FROM public.device_push_tokens dpt
    WHERE dpt.user_id = up.user_id
  ) THEN 'app'
  ELSE 'web'
END
WHERE signup_channel IS NULL;

-- 3. Constrain the domain (CHECK only; NOT NULL deferred — see Rollout).
ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_signup_channel_check
  CHECK (signup_channel IS NULL OR signup_channel IN ('web', 'app'));
```

`NOT NULL` is **not** added in this migration. Rationale in Rollout section: until the RN app ships its `channel: 'app'` change, app-originated signups would land as `NULL` and break a `NOT NULL` constraint. Phase 2 migration adds `NOT NULL` after the RN release.

Backfill caveat: historical accuracy is best-effort. New registrations from the day this ships forward are authoritative (web side); rows created before will reflect "ever opened app" rather than "registered on app". This is the right tradeoff — the only alternative is leaving channel `NULL` for all existing users, which makes early dashboard reads useless.

### Code changes for new registrations

1. **`src/app/api/auth/complete-signup/route.ts`** — accept `channel` in request body, validate against `['web', 'app']`, persist into `user_profiles.signup_channel` on the existing upsert at line 139. If `channel` missing or invalid → `400`. (Strict because every client we control passes it; only an unknown caller would skip it.)
2. **Web client** (`src/components/auth/SignInCard.tsx` and any other site that POSTs to `/api/auth/complete-signup`) — pass `channel: 'web'` in the request body.
3. **App client** (in `~/Github/mandys_bubble_tea_app`, the React Native repo) — pass `channel: 'app'` in the request body of every `complete-signup` POST. Tracked as a separate task in the implementation plan because it lives in a different repo.

---

## Page Content

### Top: 8 KPI tiles (responsive grid — 1 col mobile, 2 col tablet, 4 col desktop)

| # | Tile | Formula |
|---|---|---|
| 1 | Total members | `count(auth.users)` |
| 2 | Web registrations | `count(*) where signup_channel='web'` + `% of total` |
| 3 | App registrations | `count(*) where signup_channel='app'` + `% of total` |
| 3a | Unknown channel (subtitle on tile 1, not a separate tile) | `count(*) where signup_channel IS NULL` — disappears once Phase 2 NOT NULL ships |
| 4 | New this month | `count where created_at >= current_month_start` + arrow vs previous month |
| 5 | New this week | `count where created_at >= current_week_start` + arrow vs previous week |
| 6 | Ordered vs registered-only | `(members with ≥1 Square order) / (total members)` shown as `X / Y` plus conversion `%` |
| 7 | Loyalty: 9-of-9 | `count(loyalty accounts with availableRewards.length > 0)` and `count(balance >= 9)` (two small numbers) |
| 8 | Rewards redeemed this month | `count(REDEEM_REWARD events where created_at >= current_month_start)` |

All "this month" / "this week" calculations use **Australia/Brisbane** timezone (matches store ops). Helper already exists in the codebase per `.claude/CLAUDE.md` notes.

### Middle: 3 charts

1. **New members trend (line chart)** — last 90 days, daily buckets, two lines: web (orange) and app (blue). Toggle between daily / weekly bucketing if needed in v2.
2. **Channel distribution (donut)** — web vs app, current snapshot. Same data as tiles 2 & 3, visualized.
3. **Registration → first-order funnel (horizontal bar)** — three bars: `Registered` → `Placed ≥1 order` → `Placed ≥2 orders` (repeat customers). Each bar shows count + % of step before.

Library: **Recharts** (declarative, plays well with Tailwind, no canvas).

### Bottom: Top 10 customers table

Sorted by lifetime spend (Square `customer.lifetimeSpendMoney`). Columns:

| Column | Notes |
|---|---|
| Name | `first_name + last_name` from `user_profiles` |
| Phone | masked: `+61 4xx xxx 123` (last 3 digits only — privacy) |
| Channel | `signup_channel` value |
| Total orders | from Square Customers API |
| Lifetime spend | formatted AUD |
| Last order | `MMM D, YYYY` |

Privacy decision: phone masked by default. No "reveal" affordance in v1 — owner already has the full record in Square Dashboard if she needs it.

---

## API Routes

Single new internal route: `src/app/api/admin/members-stats/route.ts`

- `GET` only. Wrapped by same admin-only check used elsewhere (`admin_users` row required).
- Returns one JSON payload with all data needed by the page (KPI numbers, 90-day trend series, channel donut data, funnel data, top-10 list).
- Server-side: parallel `Promise.all` of:
  - Supabase aggregations (single SQL via `.rpc()` or Postgres function for atomicity)
  - Square Loyalty list + events
  - Square Orders aggregation (paginated, capped — see "Bounded scans" below)
- Returns `{ generatedAt: ISOString, ... }` so the UI can show "data as of X minutes ago".

### Bounded scans

Square Orders API can return many pages for a healthy store. To avoid runaway latency, the orders aggregation only scans the **trailing 90 days** of orders (sufficient for "ordered vs registered-only" + funnel — anyone who registered >90d ago and never ordered is, by definition, in the "registered-only" bucket regardless of order data).

---

## Visual / Style

- Match existing `/admin/prints` style (already shipped, sets the convention).
- Brand red `#C43A10` for primary accents and "web" series in charts.
- Cream `#F5E6C8` backgrounds for KPI tiles.
- Mobile-first layout — Mandy is most likely to glance on phone. Charts use `ResponsiveContainer`.

---

## Testing

- **Vitest unit**: SQL aggregation helpers (mock the `auth.users` / `user_profiles` rows, assert tile numbers).
- **Vitest unit**: backfill SQL idempotence — run migration twice, second run is no-op.
- **Manual on Vercel preview**: open `/admin/members`, eyeball the 8 tiles against Square Dashboard reality, click around charts.
- No e2e — admin-only page, no public-facing risk surface.

---

## Rollout

1. Ship migration to prod via Supabase Studio (low risk; backfill is one UPDATE).
2. Ship code change behind no flag — admin-only route, invisible to customers.
3. Backfill runs once at migration time; no re-run needed.
4. App-side `channel: 'app'` change ships in the next RN app release (separate repo, separate ASC submission). Until then, app-originated signups land with `signup_channel = NULL` (the v1 migration intentionally allows NULL — see Schema Change). The dashboard treats NULL as "unknown" in the channel breakdown so the numbers stay honest rather than silently mis-attributing to web.
5. Phase 2 follow-up migration (after the RN release ships and we've confirmed all new signups carry a channel for ≥7 days): add `NOT NULL` to `signup_channel`. Tracked as a separate item in DEV_QUEUE, not part of this v1.

Alternative considered and rejected: server-side UA sniffing of the `complete-signup` request to default app callers to `'app'`. UA strings are brittle (RN WebView edge cases, Expo dev client) and we'd be locked in once data accumulated. Better to wait the few days for the RN release.

---

## Open Items (resolve in implementation plan, not blocking)

- Exact Postgres function vs inline SQL for KPI tiles (perf vs maintainability).
- Whether to gate the new admin route on a feature flag or ship behind admin-only access (probably the latter — there's no customer-facing exposure).
- App-repo coordination: who owns merging the `channel: 'app'` change in `mandys_bubble_tea_app`.
