# Online Ordering — POS Backup Mode Switch

**Date**: 2026-05-16
**Author**: Stan + Claude (`/dev`)
**Status**: Approved, awaiting plan

## Problem

When the in-store POS (Square Register) fails, online orders are the only working channel — but right now online ordering closes 15 minutes before the physical store (22:15 vs 22:30) so staff can finish the last cup. During a POS outage that 15-minute cutoff is dead weight: there's nothing to "finish" and the store needs every channel running until closing time.

We need an operator-toggled mode that extends the online cutoff to match the physical close (22:30) for the duration of an outage, then flips back to the normal 15-minute buffer.

## Goals

- One toggle in `admin.mandybubbletea.com/members` flips online ordering between **normal** (10:30am–10:15pm) and **POS backup** (10:30am–10:30pm).
- Toggle takes effect within ~30s for the customer cart UI and immediately for the `/api/orders` server gate.
- Toggle is persisted in the Mandy web Supabase project so a redeploy is not required.
- Audit trail: capture who flipped it and when.
- Cart / checkout UI keeps the existing "Orders closed · Opens X" copy outside of business hours in **both** modes — the toggle only moves the closing cutoff, not the opening time or off-hours behavior.
- Customer never sees a banner indicating mode; only the nextLabel time shifts (e.g. "until 10:30pm" vs "until 10:15pm").

## Non-goals

- Independent open-time override (we are not adding an "open early" knob).
- Per-product or per-category ordering windows.
- 24/7 mode. Both modes still close at or before 22:30 Brisbane and refuse orders before 10:30 Brisbane.
- SMS/email broadcast on flip. Operator can post in their own channel if they want to.

## Architecture

### 1. Persistence layer (Mandy web Supabase)

New table `app_settings` (key-value, future-proof for other site-wide flags):

```sql
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT  -- admin identifier (e.g. ADMIN_EMAIL). NOT a FK to auth.users —
                   -- admin auth runs on HMAC cookie + env creds, isolated from Supabase auth.
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Read: public — cart UI on the customer site needs to know effective state.
CREATE POLICY "app_settings_read_all"
  ON app_settings
  FOR SELECT
  USING (true);

-- Write: service_role only. Admin endpoint uses getSupabaseAdmin().
-- (No INSERT/UPDATE policy → defaults to deny for anon/authenticated.)
```

Seed row + immediate switch-on as part of the same migration:

```sql
INSERT INTO app_settings (key, value)
VALUES ('pos_backup_mode', 'true'::jsonb)
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value, updated_at = now();
```

After apply, `pos_backup_mode = true` is the live state. Default for the column going forward (if the row is wiped/missing) is `false` (read by code).

Migration file: `supabase/migrations/2026-05-16-app-settings.sql`.

### 2. Mandy web — effective status logic

`src/lib/store-status.ts`:

- Keep `getOrderingStatus(now: Date)` as the pure, sync, time-only function. Useful for tests and any pure-time consumer.
- Add `CLOSE_MIN` (already there) as the "backup mode" cutoff. Add no new constant.
- Add async `getEffectiveOrderingStatus(now?: Date): Promise<OrderingStatus>`:
  - Reads `pos_backup_mode` from `app_settings` via `getSupabaseAdmin()` (service-role, RLS-free, but read-only against `app_settings`).
  - 60-second in-process memo of the setting value (module-scope `{ value, fetchedAt }` cache) to avoid hammering Supabase from `/api/orders` and `/api/store-status`.
  - If `pos_backup_mode === true`: same logic as `getOrderingStatus` but with cutoff = `CLOSE_MIN` (22:30). `nextLabel` reads `until 10:30pm`.
  - If `false` (or absent / fetch fails): fall through to `getOrderingStatus()` — preserves existing 22:15 behavior under any DB failure.

### 3. Mandy web — endpoint surface

**New**: `GET /api/store-status`
- Public, no auth.
- Returns `OrderingStatus` JSON: `{ open, nextLabel }`.
- `Cache-Control: public, s-maxage=30, stale-while-revalidate=30` so Vercel edge cache absorbs traffic; combined with the 60s in-process memo, effective toggle latency is ≤ ~30s.
- `export const dynamic = "force-dynamic"` defensive (we want fresh-ish, not ISR-frozen).

**Changed**: `src/app/api/orders/route.ts:120`
- `getOrderingStatus(new Date())` → `await getEffectiveOrderingStatus(new Date())`.
- Server gate stays authoritative; the toggle is honored immediately on the very next order POST.

**Changed**: `src/components/cart/CartDrawer.tsx:688/691` and `src/app/checkout/page.tsx:222/225`
- Replace sync `getOrderingStatus()` + 60s `setInterval(recompute)` with `fetch('/api/store-status')` + 30s `setInterval(refetch)`.
- Initial render shows a neutral placeholder (no flicker into "closed" while first fetch is in flight) — `null` ordering status hides the gating UI; existing button stays primary until response lands.

### 4. Admin UI (mandys_bubble_tea_admin repo)

Drop a `<OrderingModeBanner>` at the top of `/members` (above the existing hero strip), styled with the admin's terracotta panel pattern.

**Layout**:
```
┌─────────────────────────────────────────────────────────┐
│  线上接单模式                                            │
│                                                          │
│  ○ 正常 (10:30am – 10:15pm)                            │
│    营业末 15min 不接单，让员工收尾                       │
│  ● POS 故障备用 (10:30am – 10:30pm)                    │
│    全程接单，线上当线下替补                              │
│                                                          │
│  上次切换：2026-05-16 14:32 by stan@mandybubbletea.com  │
└─────────────────────────────────────────────────────────┘
```

- Two radio rows (mutually exclusive). Selected row uses terracotta accent border + matching dot.
- Clicking the unselected row optimistically flips, fires `PATCH /api/admin/settings/ordering`, invalidates the cache. On error, rolls back + shows red toast.
- Audit line under the radios shows `updated_at` (Brisbane) + email of `updated_by` (resolved server-side via `auth.users`).

**New admin endpoint**: `PATCH /api/admin/settings/ordering`
- Auth: admin HMAC cookie (existing `requireAdmin` helper).
- Body: `{ mode: "normal" | "pos_backup" }`.
- Maps to `pos_backup_mode` boolean and upserts via `getSupabaseAdmin()` on the Mandy **web** Supabase project (`fsvtwivogyebugqhmjjy`). Admin repo will need `SUPABASE_SERVICE_ROLE_KEY` for that project in its env (verify during planning).
- Sets `updated_by = process.env.ADMIN_EMAIL` (the static admin identity per `project_mandys_admin_auth_isolation`).
- Returns the new row.

**New admin endpoint**: `GET /api/admin/settings/ordering`
- Reads current row directly (no join — `updated_by` is already a plain TEXT identifier).
- Returns `{ mode, updated_at, updated_by }`.

### 5. Customer-facing copy

- Cart drawer / checkout: when `open: true`, nextLabel is whatever the server returned — `until 10:30pm` in backup mode, `until 10:15pm` in normal. No banner, no mode indicator.
- When `open: false`, copy is unchanged: `Orders closed · Opens 10:30am` (today or tomorrow).
- No mention of "POS backup" anywhere customer-visible. The mode is an operator concept.

## Testing

- `src/lib/store-status.test.ts` extends to cover `getEffectiveOrderingStatus`:
  - `pos_backup_mode = true` + 22:14 → open with `until 10:30pm`.
  - `pos_backup_mode = true` + 22:15 → open.
  - `pos_backup_mode = true` + 22:29 → open.
  - `pos_backup_mode = true` + 22:30 → closed.
  - `pos_backup_mode = false` + 22:14 → open with `until 10:15pm`.
  - `pos_backup_mode = false` + 22:15 → closed.
  - `pos_backup_mode = false` + 10:29 → closed (open-time unchanged in both modes).
  - Setting fetch throws → falls back to sync `getOrderingStatus()` (defensive default).
- `/api/store-status` route test: returns 200 with effective status; cache header present.
- `/api/admin/settings/ordering` route tests (admin repo): unauthorized 401, valid PATCH writes row, GET returns audit line.

## Rollout

1. Apply migration via Supabase MCP (`mcp__supabase__apply_migration` against Mandy web project). Row created with `pos_backup_mode = true`.
2. Merge mandy web PR. Vercel auto-deploys. `/api/orders` immediately respects backup mode on next request.
3. Merge mandys_bubble_tea_admin PR. Vercel auto-deploys. Banner appears at top of `/members`.
4. Smoke: open `/members`, see "POS 故障备用" selected. Open customer site, add a drink to cart at any time before 22:30 — Place order button stays active. Toggle banner to normal — within ~30s, customer cart UI flips to "until 10:15pm".

## Open questions

None. All decisions resolved during brainstorming:

- Storage = Supabase KV table (`app_settings`). [Settled]
- Initial state = `pos_backup_mode: true`. [Settled]
- UI location = `/members` top banner. [Settled]
- Audit = `updated_at` + `updated_by` (TEXT, plain admin identifier — admin auth is HMAC + env, not Supabase auth). [Settled]
- Customer copy = nextLabel only, no banner. [Settled]
- Cart status delivery = polling `GET /api/store-status` every 30s. [Settled]
