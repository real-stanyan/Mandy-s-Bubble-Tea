-- Per-IP hourly counter for the public /api/chat endpoint.
-- Public + metered LLM behind it: without this, one script drains the
-- DeepSeek balance. Stores a salted hash, never a raw IP.
create table if not exists public.chat_rate_limit (
  ip_hash text not null,
  hour_bucket timestamptz not null,
  request_count integer not null default 0,
  primary key (ip_hash, hour_bucket)
);

create index if not exists chat_rate_limit_hour_bucket_idx
  on public.chat_rate_limit (hour_bucket);

-- Atomic increment-and-read. Doing this in one statement avoids the
-- read-then-write race that would let concurrent requests both see a
-- count under the limit.
create or replace function public.bump_chat_rate_limit(
  p_ip_hash text,
  p_hour_bucket timestamptz
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.chat_rate_limit (ip_hash, hour_bucket, request_count)
  values (p_ip_hash, p_hour_bucket, 1)
  on conflict (ip_hash, hour_bucket)
  do update set request_count = chat_rate_limit.request_count + 1
  returning request_count into v_count;
  return v_count;
end;
$$;

alter table public.chat_rate_limit enable row level security;

-- Supabase's default privileges grant EXECUTE on new public-schema functions
-- to anon/authenticated directly, and PostgreSQL grants it to PUBLIC. Left
-- alone this RPC is callable from any browser holding the public anon key,
-- and (were it still SECURITY DEFINER) would bypass the RLS enabled above.
-- Only the service-role client ever calls it. Same lockdown as
-- consume_topping_allowance (2026-06-12-tier-topping-usage.sql). SECURITY
-- INVOKER above removes the privilege-escalation primitive itself — the
-- revoke/grant here is defense in depth in case the ACL ever drifts.
revoke all on function public.bump_chat_rate_limit(text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.bump_chat_rate_limit(text, timestamptz)
  to service_role;
