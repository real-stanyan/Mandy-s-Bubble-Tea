-- Device push tokens + idempotent order-ready send ledger.
-- See docs/superpowers/plans/2026-04-20-order-ready-push-notifications.md

-- No RLS: accessed exclusively via service-role client (getSupabaseAdmin).
-- Do not wire client-side queries to this table without adding policies.
create table if not exists device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('ios','android')),
  app_version text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists device_push_tokens_user_id_idx
  on device_push_tokens (user_id);

-- One row per (order, event kind) prevents duplicate pushes when
-- Square redelivers the webhook (they retry on non-2xx). Insert with
-- onConflict=ignoreDuplicates: if the insert succeeded, send the push; if it
-- was a no-op, the push already went out.
create table if not exists order_push_notifications (
  order_id text not null,
  kind text not null check (kind in ('ready')),
  sent_at timestamptz not null default now(),
  primary key (order_id, kind)
);
