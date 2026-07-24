-- App-download promo: one-order 20%-off ticket, claimed on the web by phone
-- (before the customer ever signs into the app), redeemed later exactly once.
--
-- Phone is the identity anchor that already exists at web-claim time; the
-- signed-in app user carries phone_e164 on their profile, so the grant is
-- resolved by phone with NO install attribution (no Branch/Adjust/deep-link).
-- Whole-order percentage, exclusive + better-of — mirrors flash_promos' money
-- semantics, but claim-gated per phone instead of store-wide.
-- See docs/adr/0002-app-download-discount.md.

create table if not exists app_download_grants (
  phone_e164   text primary key,          -- claim-time anchor; UNIQUE = one per phone
  percentage   int not null default 20
                 check (percentage > 0 and percentage <= 100),
  claimed_at   timestamptz not null default now(),
  redeemed_at  timestamptz,               -- flips null -> now() once, at burn
  order_id     text,                       -- the order that burned it
  customer_id  text,                       -- resolved at redeem (audit only)
  created_at   timestamptz not null default now()
);

-- Atomic one-shot burn. The update matches exactly once per phone
-- (redeemed_at flips null -> now()); a second call (double-tap, retry, a
-- replayed webhook, or the delivery accept path re-running) matches no rows
-- and reports consumed=0. Mirrors consume_flash_promo's insert-if-absent
-- idempotency, expressed as an update-if-unredeemed.
create or replace function consume_app_download_discount(
  p_phone text,
  p_order_id text,
  p_customer_id text
) returns table (consumed_count int)
language plpgsql as $$
begin
  update app_download_grants
     set redeemed_at = now(),
         order_id = p_order_id,
         customer_id = coalesce(customer_id, p_customer_id)
   where phone_e164 = p_phone
     and redeemed_at is null;
  if found then
    return query select 1;
  else
    return query select 0;
  end if;
end;
$$;
