-- Mystery box v2: unlocked by a secret code posted on Instagram, not a
-- daily freebie (Stan, 2026-08-17 — the box exists to grow the IG follow,
-- and "come back tomorrow" gave it away for nothing). A code opens ONE box
-- per customer; posting a new code on IG starts the next round.
--
-- Additive + idempotent (ADR-0004). Verify object:
--   select to_regclass('public.mystery_box_codes');

create table if not exists mystery_box_codes (
  code        text primary key,           -- stored lowercase, compared trimmed
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Which code minted a coupon; old rows (daily era) stay null.
alter table mystery_coupons
  add column if not exists code text;

-- One box per (customer, code) — replaces the one-per-day rule.
drop index if exists mystery_coupons_daily_idx;
create unique index if not exists mystery_coupons_phone_code_idx
  on mystery_coupons (phone_e164, code);
