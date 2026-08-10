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
security definer
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
