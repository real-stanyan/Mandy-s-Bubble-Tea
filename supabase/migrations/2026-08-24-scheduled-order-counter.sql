-- Scheduled pickups get their own daily counter (OL700, OL701, …).
--
-- Until now the OL7xx look was faked by relabelling the online counter's
-- OL8xx (pickup-schedule.ts: replace(/^OL8/, "OL7")). The day online
-- orders passed 99 the counter walked into OL9xx, the regex stopped
-- matching, and scheduled tickets printed OL9xx — indistinguishable from
-- ASAP (Stan's report, 2026-08-23: a scheduled ticket printed OL9xx
-- instead of OL7xx on the first 100-order day).
--
-- Own series instead: order_counters gains a 'scheduled' row per day,
-- seeded 699 so the first scheduled order of the day is OL700. Distinct
-- from ASAP OL8xx/OL9xx and delivery DExxx by construction, no matter how
-- busy the day. Past OL799 the series would collide with real ASAP
-- numbers, so the app falls back to the old relabel behaviour there
-- (100 scheduled orders in one day — a nice problem to have).
--
-- Additive + idempotent. Verify object:
--   select proname from pg_proc where proname = 'next_scheduled_order_number';
-- End-to-end verify (CONSUMES one number):
--   select next_scheduled_order_number();  -- expect 'OL700' on first call of the day
--
-- Applied to production 2026-09-02 via the Management API.

-- order_counters ships with check (type in ('instore','online')) — without
-- widening it the function below fails its INSERT with 23514 at runtime,
-- which the orders route's fallback silently swallows (exactly what
-- happened between 2026-08-24 and 2026-09-02: the fix looked deployed but
-- every scheduled order still fell back to the OL8→OL7 relabel).
alter table order_counters drop constraint if exists order_counters_type_check;
alter table order_counters add constraint order_counters_type_check
  check (type = any (array['instore'::text, 'online'::text, 'scheduled'::text]));

create or replace function next_scheduled_order_number()
returns text
language plpgsql
as $$
declare
  today date := (current_timestamp at time zone 'Australia/Brisbane')::date;
  v int;
begin
  insert into order_counters (date, type, last_seq)
    values (today, 'scheduled', 699)
    on conflict (date, type) do nothing;
  update order_counters
    set last_seq = last_seq + 1
    where date = today and type = 'scheduled'
    returning last_seq into v;
  return 'OL' || v;
end;
$$;
