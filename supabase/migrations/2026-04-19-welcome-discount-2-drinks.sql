-- Welcome discount: switch from single-use "30% off first order" to
-- 2-drink quota ("30% off first 2 drinks", roll-over between orders).
-- See docs/superpowers/plans/2026-04-19-welcome-discount-2-drinks.md

-- 1. Add drinks_remaining (defaults to 2 for new rows; existing unused rows
--    keep their allowance; existing used rows get 0).
alter table welcome_discounts
  add column if not exists drinks_remaining int not null default 2
    check (drinks_remaining >= 0);

-- Migrate legacy `state` column into drinks_remaining, if it exists.
-- unused rows → 2 (full allowance); used rows → 0 (fully consumed).
update welcome_discounts
  set drinks_remaining = case when state = 'used' then 0 else 2 end
  where state is not null;

-- 2. Drop legacy schema now that drinks_remaining is authoritative.
alter table welcome_discounts drop column if exists state;
drop function if exists consume_welcome_discount(text, text);

-- 3. Install new consume RPC. Atomically decrements drinks_remaining by
--    min(p_count, current remaining), returns both the amount consumed
--    and the new remaining. Stamps used_at + order_id only when the row
--    hits zero so callers can distinguish partial from final consumption.
create or replace function consume_welcome_discount(
  p_customer_id text,
  p_order_id text,
  p_count int
) returns table (consumed_count int, drinks_remaining int)
language plpgsql as $$
declare
  v_before int;
  v_after int;
  v_consumed int;
begin
  select wd.drinks_remaining into v_before
    from welcome_discounts wd
    where wd.customer_id = p_customer_id
    for update;

  if v_before is null or v_before <= 0 or p_count <= 0 then
    return query select 0, coalesce(v_before, 0);
    return;
  end if;

  v_consumed := least(p_count, v_before);
  v_after := v_before - v_consumed;

  update welcome_discounts
    set drinks_remaining = v_after,
        used_at = case when v_after = 0 then now() else used_at end,
        order_id = case when v_after = 0 then p_order_id else order_id end
    where customer_id = p_customer_id;

  return query select v_consumed, v_after;
end;
$$;
