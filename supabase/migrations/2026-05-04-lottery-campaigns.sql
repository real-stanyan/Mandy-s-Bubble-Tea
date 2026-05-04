-- 2026-05-04 lottery-campaigns: app-only weighted-random prize rolls

create table if not exists public.campaigns (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  prize_pool  jsonb not null,
  is_active   boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint campaigns_window check (ends_at > starts_at)
);

create unique index if not exists campaigns_one_active
  on public.campaigns (is_active) where is_active = true;

create table if not exists public.prize_rolls (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       uuid not null references public.campaigns(id),
  user_id           uuid not null references auth.users(id),
  square_order_id   text not null,
  tier_id           text not null,
  prize_type        text not null
    check (prize_type in ('thank_you', 'digital', 'physical')),
  prize_payload     jsonb not null default '{}'::jsonb,
  status            text not null default 'won_active'
    check (status in ('won_active', 'redeemed', 'claimed', 'expired', 'voided')),
  expires_at        timestamptz,
  redeemed_order_id text,
  claimed_at        timestamptz,
  voided_at         timestamptz,
  claim_code        text unique,
  rolled_at         timestamptz not null default now(),
  unique (square_order_id)
);

create index if not exists prize_rolls_active_digital
  on public.prize_rolls (user_id, expires_at)
  where prize_type = 'digital' and status = 'won_active';

create index if not exists prize_rolls_user_physical_cap
  on public.prize_rolls (user_id, campaign_id)
  where prize_type = 'physical' and status in ('won_active', 'claimed', 'expired');

create index if not exists prize_rolls_claim_code
  on public.prize_rolls (claim_code) where claim_code is not null;

-- RLS: users can read their own rolls; service role full access.
alter table public.prize_rolls enable row level security;

create policy "users read own prize_rolls"
  on public.prize_rolls
  for select
  using (auth.uid() = user_id);

create policy "service role full access prize_rolls"
  on public.prize_rolls
  for all
  to service_role
  using (true)
  with check (true);

-- campaigns is read-only to clients; only service role writes.
alter table public.campaigns enable row level security;

create policy "anyone reads active campaigns"
  on public.campaigns
  for select
  using (is_active = true);

create policy "service role full access campaigns"
  on public.campaigns
  for all
  to service_role
  using (true)
  with check (true);
