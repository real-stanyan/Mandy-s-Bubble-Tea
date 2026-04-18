-- Supabase Auth integration data model. Every auth.users row gets a
-- user_profiles row that maps it to a Square customer + phone. Phone is
-- the loyalty identity axis (Square loyalty account mappings, SMS pickup
-- notifications, kitchen ticket name), so even OAuth users need to bind
-- a verified phone before they can place an order.
--
-- Run this in Supabase Dashboard → SQL Editor.

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  square_customer_id text unique,
  phone_e164 text unique,
  first_name text,
  last_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_profiles_phone_idx on public.user_profiles (phone_e164);
create index if not exists user_profiles_square_customer_idx on public.user_profiles (square_customer_id);

create or replace function public.user_profiles_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_profiles_touch_updated_at on public.user_profiles;
create trigger user_profiles_touch_updated_at
  before update on public.user_profiles
  for each row execute function public.user_profiles_touch_updated_at();

-- RLS: users read/update their own row; service role bypasses RLS and
-- is what the API routes use for reads/writes that span users (e.g.
-- looking up a profile by phone during OTP linking).
alter table public.user_profiles enable row level security;

drop policy if exists "users read own profile" on public.user_profiles;
create policy "users read own profile"
  on public.user_profiles for select
  using (auth.uid() = user_id);

drop policy if exists "users update own profile" on public.user_profiles;
create policy "users update own profile"
  on public.user_profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- No insert/delete policies for end users — those happen server-side via
-- the service role during the complete-signup flow.
