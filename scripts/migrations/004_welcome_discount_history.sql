-- Welcome discount tombstone: close the delete-account → re-signup →
-- fresh welcome loop. welcome_discounts is keyed by square_customer_id
-- and is deliberately deleted by purgeAccount (so a returning customer
-- can re-register with the same phone), which means deleting the account
-- also deleted the only record that welcome was ever consumed.
--
-- welcome_discount_history records consumption keyed by PHONE (the
-- OTP-verified identity that survives account deletion). purgeAccount
-- must never touch this table. Grant-side gate lives in
-- grantWelcomeDiscount (src/lib/supabase.ts): a phone present here never
-- receives a new welcome_discounts row.

-- 1. History table. One row per phone that has ever consumed any part of
--    a welcome allowance.
create table if not exists welcome_discount_history (
  phone_e164 text primary key,
  first_consumed_at timestamptz not null default now(),
  last_consumed_at timestamptz not null default now(),
  last_customer_id text,
  drinks_consumed int not null default 0
);

-- Service-role only: RLS on, no policies.
alter table welcome_discount_history enable row level security;

-- 2. Rewire the consume RPC to also stamp history. Phone comes from
--    user_profiles via the customer_id (present for every logged-in
--    online customer — welcome is only consumable by logged-in users).
--    History write is best-effort inside the same transaction: a missing
--    profile row (shouldn't happen) just skips the stamp.
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
  v_phone text;
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

  select up.phone_e164 into v_phone
    from user_profiles up
    where up.square_customer_id = p_customer_id
    limit 1;

  if v_phone is not null then
    insert into welcome_discount_history
        (phone_e164, last_customer_id, drinks_consumed)
      values (v_phone, p_customer_id, v_consumed)
      on conflict (phone_e164) do update
        set last_consumed_at = now(),
            last_customer_id = excluded.last_customer_id,
            drinks_consumed = welcome_discount_history.drinks_consumed
              + excluded.drinks_consumed;
  end if;

  return query select v_consumed, v_after;
end;
$$;
