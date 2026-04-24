-- Fix: next_online_order_number() was keyed by UTC date, so between
-- Brisbane 00:00–10:00 the counter kept appending to the previous
-- day's row instead of resetting to OL800. Switch it to the same
-- Australia/Brisbane boundary that next_store_order_number() uses.
--
-- Preserves existing semantics:
--   - table: order_counters(date, type, last_seq) with primary key (date, type)
--   - first call of the day returns OL800, subsequent calls increment
--
-- Apply in Supabase Dashboard → SQL Editor.

create or replace function next_online_order_number()
returns text
language plpgsql
as $$
declare
  today date := (current_timestamp at time zone 'Australia/Brisbane')::date;
  v int;
begin
  insert into order_counters (date, type, last_seq)
    values (today, 'online', 799)
    on conflict (date, type) do nothing;
  update order_counters
    set last_seq = last_seq + 1
    where date = today and type = 'online'
    returning last_seq into v;
  return 'OL' || v;
end;
$$;

-- Cleanup: two test RPC calls today inflated the 2026-04-24 counter to
-- 801. Roll back so the first real order of the day gets OL800.
update order_counters
  set last_seq = 799
  where date = (current_timestamp at time zone 'Australia/Brisbane')::date
    and type = 'online'
    and last_seq = 801;
