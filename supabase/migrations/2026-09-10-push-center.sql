-- Push Center (/staff/push): audiences from a per-customer state table,
-- and a ledger with one row per device per send.
--
-- Why a state table: "who ordered once 5–14 days ago" or "which regulars are
-- overdue" needs every customer's order history, and paging 30k Square
-- orders inside a request is neither fast nor polite. The cron folds new
-- orders in every half hour; the page reads one table.
--
-- Why a row per device: a ticket says Expo accepted the message, the receipt
-- says APNs/FCM took it, and until now neither was stored (#384). Both go on
-- the recipient row, success included, so a send's fate is one query.
--
-- Additive DDL only (ADR-0004). Apply with:
--   supabase db query --linked "select to_regclass('public.push_runs')"
--   supabase db query --linked -f supabase/migrations/2026-09-10-push-center.sql
--   supabase db query --linked "select to_regclass('public.push_runs')"

create table if not exists push_customer_state (
  customer_id    text primary key,                 -- Square customer id
  first_order_at timestamptz,
  last_order_at  timestamptz,
  last_channel   text,                             -- pos | web | app | other
  order_count    int not null default 0,
  recent_orders  jsonb not null default '[]'::jsonb, -- [{id, at, ch}] newest 30, oldest first
  item_counts    jsonb not null default '{}'::jsonb, -- {"Brown Sugar Milk Tea": 12, ...} top 12
  evening_orders int not null default 0,           -- placed 17:00+ Brisbane
  updated_at     timestamptz not null default now()
);

create index if not exists push_customer_state_last_order_idx
  on push_customer_state (last_order_at desc);

create table if not exists push_runs (
  id                  uuid primary key default gen_random_uuid(),
  campaign            text not null,
  title               text not null,
  body                text not null,
  url                 text not null,
  settings            jsonb not null default '{}'::jsonb,
  -- The funnel the sender saw, so a run that reached nobody is explainable.
  matched_count       int not null default 0,
  reachable_count     int not null default 0,
  cooldown_count      int not null default 0,
  capped_count        int not null default 0,
  targeted_count      int not null default 0,
  accepted_count      int not null default 0,
  errored_count       int not null default 0,
  delivered_count     int,
  failed_count        int,
  receipts_checked_at timestamptz,
  created_by          text,                        -- staff role that clicked send
  created_at          timestamptz not null default now()
);

create index if not exists push_runs_created_idx on push_runs (created_at desc);

create table if not exists push_run_recipients (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null references push_runs (id) on delete cascade,
  campaign        text not null,
  user_id         uuid,
  customer_id     text,
  phone_e164      text,
  token           text not null,
  platform        text,
  ticket_id       text,
  ticket_error    text,
  receipt_status  text,                            -- 'ok' or the Expo error code
  receipt_message text,
  receipt_at      timestamptz,
  sent_at         timestamptz not null default now()
);

create index if not exists push_run_recipients_run_idx
  on push_run_recipients (run_id);
-- Cooldown and the weekly cap read by user, newest first.
create index if not exists push_run_recipients_user_sent_idx
  on push_run_recipients (user_id, sent_at desc);
create index if not exists push_run_recipients_sent_idx
  on push_run_recipients (sent_at desc);

-- Service-role only: RLS on, no policies. Written by the staff API routes
-- and the cron, never read from the browser.
alter table push_customer_state enable row level security;
alter table push_runs enable row level security;
alter table push_run_recipients enable row level security;
