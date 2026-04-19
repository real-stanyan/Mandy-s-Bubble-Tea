-- Adds a last-verified timestamp so /api/me can skip the Square
-- customers.get round-trip when it already knows the customer existed
-- recently. The customer.deleted webhook is the primary self-heal path;
-- this column just rate-limits the defensive fallback from "every
-- hydration" to "once per TTL".
--
-- Run this in Supabase Dashboard → SQL Editor.

alter table public.user_profiles
  add column if not exists square_verified_at timestamptz;

-- Partial index for the "needs re-verify" scan — most rows are recent
-- so a partial index on nulls/old values is cheaper than a full one.
create index if not exists user_profiles_square_verified_at_idx
  on public.user_profiles (square_verified_at)
  where square_verified_at is not null;
