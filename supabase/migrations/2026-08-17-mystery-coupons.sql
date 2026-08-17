-- Mystery box (chat "给我惊喜"): the customer opens a box in the chat, the
-- SERVER draws a prize (odds live in code, never the model or the client),
-- and the prize lands here as a coupon in their rewards. Checkout auto-
-- applies the best live coupon through the normal discount ladder and burns
-- it atomically on payment.
--
-- Identity anchor is phone_e164, same as app_download_grants: it exists for
-- every signed-in customer and survives account re-creation (the loyalty
-- cooldown lesson — a deleted/recreated account must not reset the clock).
--
-- Additive + idempotent (ADR-0004). Verify object:
--   select to_regclass('public.mystery_coupons');

create table if not exists mystery_coupons (
  id           uuid primary key default gen_random_uuid(),
  phone_e164   text not null,
  customer_id  text,                      -- resolved at draw (audit)
  prize        text not null check (prize in ('pct5','pct10','pct15','free_topping','free_drink')),
  percentage   int check (percentage is null or (percentage > 0 and percentage <= 100)),
  drawn_at     timestamptz not null default now(),
  expires_at   timestamptz not null,
  redeemed_at  timestamptz,               -- flips null -> now() once, at burn
  order_id     text,                      -- the order that burned it
  created_at   timestamptz not null default now()
);

-- Checkout scans "this phone's live coupons" on every quote.
create index if not exists mystery_coupons_live_idx
  on mystery_coupons (phone_e164)
  where redeemed_at is null;

-- One draw per phone per Brisbane day — enforced by the DATABASE, not by
-- application politeness: a double-tap or a parallel request hits 23505 and
-- the second draw simply doesn't exist.
create unique index if not exists mystery_coupons_daily_idx
  on mystery_coupons (phone_e164, ((drawn_at at time zone 'Australia/Brisbane')::date));

-- Atomic one-shot burn, mirroring consume_app_download_discount: the update
-- matches exactly once (redeemed_at flips null -> now()); a retry or a
-- replayed webhook matches no rows and reports consumed=0.
create or replace function consume_mystery_coupon(
  p_id uuid,
  p_phone text,
  p_order_id text,
  p_customer_id text
) returns table (consumed_count int)
language plpgsql as $$
begin
  update mystery_coupons
     set redeemed_at = now(),
         order_id = p_order_id,
         customer_id = coalesce(customer_id, p_customer_id)
   where id = p_id
     and phone_e164 = p_phone
     and redeemed_at is null
     and expires_at > now();
  if found then
    return query select 1;
  else
    return query select 0;
  end if;
end;
$$;
