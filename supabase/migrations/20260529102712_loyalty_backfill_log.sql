create table if not exists public.loyalty_backfill_log (
  square_order_id text primary key,
  loyalty_account_id text,
  points int,
  source text not null check (source in ('webhook','cron','retro')),
  created_at timestamptz not null default now()
);
alter table public.loyalty_backfill_log enable row level security;
