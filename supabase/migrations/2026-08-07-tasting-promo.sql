-- Tasting promo: one named drink at a flat "come try it" price for a date
-- window, app-only. Unlike flash_promos (whole-order percentage, one Brisbane
-- day) and app_download_grants (per-phone ticket), this one is ITEM-level and
-- has no per-customer grant row: while the window is open every app order can
-- take the tasting price on one cup of the named product. The window is the
-- bound, so nothing is burned and there is no redemptions table.
--
-- product_name matches the Square catalog item name (case/whitespace
-- insensitive at match time) — the promo is authored against the menu, not
-- against a variation id, so a size split or a re-added item does not silently
-- turn the promo off.
--
-- pushed_at is what stops a second click of the send endpoint re-notifying
-- everyone: there is no per-campaign recipients table for this promo, so the
-- promo row itself carries the "already announced" record.
-- See docs/adr/0009-tasting-promo.md.

create table if not exists tasting_promos (
  key                  text primary key,
  product_name         text not null,
  tasting_price_cents  int not null
                         check (tasting_price_cents >= 0),
  starts_at            timestamptz not null default now(),
  ends_at              timestamptz not null,
  active               boolean not null default true,
  pushed_at            timestamptz,
  created_at           timestamptz not null default now(),
  check (ends_at > starts_at)
);

-- The pricing path asks "which promo is open right now?" on every quote and
-- every order create, so the window lookup gets an index of its own.
create index if not exists tasting_promos_window_idx
  on tasting_promos (starts_at, ends_at)
  where active;
