-- Welcome discount: one-time 30% off for newly-created customers.
-- See docs/superpowers/specs/2026-04-17-welcome-discount-design.md

create table if not exists welcome_discounts (
  customer_id text primary key,
  state text not null default 'unused' check (state in ('unused','used')),
  percentage int not null default 30,
  granted_at timestamptz not null default now(),
  used_at timestamptz,
  order_id text
);

-- Atomic consume: flips state to 'used' only if currently 'unused'.
-- Returns empty if already used or row missing.
create or replace function consume_welcome_discount(
  p_customer_id text,
  p_order_id text
) returns table (consumed bool, percentage int)
language sql as $$
  update welcome_discounts
  set state = 'used', used_at = now(), order_id = p_order_id
  where customer_id = p_customer_id and state = 'unused'
  returning true as consumed, percentage;
$$;
