-- Cup-sticker auto-print tables + counters.
-- See docs/superpowers/specs/2026-04-22-cup-sticker-print-design.md

-- ---------- print_jobs ----------
-- One row per Square order (web or POS). unique(square_order_id) is the
-- dedup mechanism; the Vercel webhook INSERTs with ON CONFLICT DO NOTHING
-- so redelivery and repeated order.updated events are safe.
create table if not exists print_jobs (
  id                uuid primary key default gen_random_uuid(),
  square_order_id   text not null unique,
  source            text not null check (source in ('web', 'pos')),
  sticker_number    text not null,
  order_total_cents integer not null,
  cups              jsonb not null,
  status            text not null default 'pending'
                     check (status in ('pending', 'printed', 'failed', 'stale')),
  attempts          integer not null default 0,
  last_error        text,
  created_at        timestamptz not null default now(),
  printed_at        timestamptz
);

create index if not exists print_jobs_status_created_idx
  on print_jobs (status, created_at);

-- Expose to Realtime (postgres_changes on INSERT).
alter publication supabase_realtime add table print_jobs;

-- ---------- store_order_counters ----------
-- Daily counter for TA numbering. Keyed by local day in Australia/Brisbane.
create table if not exists store_order_counters (
  day    date primary key,
  last_n integer not null default 0
);

create or replace function next_store_order_number()
returns integer
language plpgsql
as $$
declare
  today date := (current_timestamp at time zone 'Australia/Brisbane')::date;
  v int;
begin
  insert into store_order_counters (day) values (today)
    on conflict (day) do nothing;
  update store_order_counters
    set last_n = last_n + 1
    where day = today
    returning last_n into v;
  return v;
end;
$$;

-- ---------- printer_heartbeats ----------
-- Mac mini upserts every 30s. /admin/prints reads this to show health.
create table if not exists printer_heartbeats (
  device_id      text primary key,
  last_seen_at   timestamptz not null,
  printer_status text,
  pending_count  integer
);

-- ---------- admin_users ----------
-- Owner allow-list for /admin/prints. Seeded manually.
create table if not exists admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role    text not null check (role in ('owner'))
);

-- ---------- RLS ----------
-- print_jobs: service-role (Vercel + Mac mini) writes; admin owners read via
-- SSR server components using service-role — no RLS policies needed here,
-- but we enable RLS as a defence-in-depth measure.
alter table print_jobs enable row level security;
alter table printer_heartbeats enable row level security;
alter table admin_users enable row level security;
-- (No policies added; service-role bypasses RLS. Any future anon/authed
-- client that needs read access must have a policy added explicitly.)
