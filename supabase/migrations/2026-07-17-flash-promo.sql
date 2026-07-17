-- Flash promo: store-wide percentage-off, one order per customer, valid for a
-- single Brisbane calendar day. No per-customer grant rows — every Square
-- customer is eligible while the promo is active; a redemption row is what
-- burns the ticket. Future campaigns are a new flash_promos row, no code.

create table if not exists flash_promos (
  key         text primary key,
  percentage  int not null
                check (percentage > 0 and percentage <= 100),
  promo_date  date not null,            -- Brisbane calendar day the promo runs
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists flash_promo_redemptions (
  promo_key    text not null references flash_promos(key),
  customer_id  text not null,
  order_id     text not null,
  redeemed_at  timestamptz not null default now(),
  primary key (promo_key, customer_id)
);

-- Atomic one-shot burn. Insert wins exactly once per (promo, customer);
-- a second call (double-tap, retry, replayed webhook) reports consumed=0.
create or replace function consume_flash_promo(
  p_promo_key text,
  p_customer_id text,
  p_order_id text
) returns table (consumed_count int)
language plpgsql as $$
begin
  insert into flash_promo_redemptions (promo_key, customer_id, order_id)
    values (p_promo_key, p_customer_id, p_order_id)
    on conflict (promo_key, customer_id) do nothing;
  if found then
    return query select 1;
  else
    return query select 0;
  end if;
end;
$$;
