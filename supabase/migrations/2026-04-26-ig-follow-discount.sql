-- IG Follow promo: one-time 10% off ticket per Square customer.
-- See docs/superpowers/specs/2026-04-26-ig-follow-discount-design.md
-- Mirrors welcome_discounts shape so callers can share helpers.

create table if not exists ig_follow_discounts (
  customer_id      text primary key,
  percentage       int not null default 10
                     check (percentage > 0 and percentage <= 100),
  drinks_remaining int not null default 1
                     check (drinks_remaining >= 0),
  claimed_at       timestamptz not null default now(),
  redeemed_at      timestamptz,
  order_id         text,
  created_at       timestamptz not null default now()
);

create or replace function consume_ig_follow_discount(
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
  select ig.drinks_remaining into v_before
    from ig_follow_discounts ig
    where ig.customer_id = p_customer_id
    for update;

  if v_before is null or v_before <= 0 or p_count <= 0 then
    return query select 0, coalesce(v_before, 0);
    return;
  end if;

  v_consumed := least(p_count, v_before);
  v_after := v_before - v_consumed;

  update ig_follow_discounts
    set drinks_remaining = v_after,
        redeemed_at = case when v_after = 0 then now() else redeemed_at end,
        order_id = case when v_after = 0 then p_order_id else order_id end
    where customer_id = p_customer_id;

  return query select v_consumed, v_after;
end;
$$;
