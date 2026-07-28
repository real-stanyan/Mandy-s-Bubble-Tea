-- One-off backfill (2026-07-28, authorised by Stan): mint the app-download
-- 20%-off grant for customers who ALREADY have the app installed.
--
-- Why they were missed: the grant is only minted by the website campaign
-- popup, whose whole pitch is "download the app". Someone who installed the
-- app months ago never had a reason to claim, so the promo skipped exactly the
-- customers who already did the thing it rewards.
--
-- "Has the app" = a row in device_push_tokens. That is the only hard signal:
-- a push token exists solely because the app registered it. user_profiles
-- .signup_channel is useless here — it records where the ACCOUNT was created,
-- and only 12 of 2621 profiles say 'app' because almost everyone signs up on
-- the web first and installs later.
--
-- Idempotent: ON CONFLICT DO NOTHING against the phone_e164 primary key, so
-- re-running changes nothing and existing grants (claimed or already redeemed)
-- are never touched or reset.
--
-- Run with (see docs/adr/0004):
--   supabase db query --linked -f scripts/backfill-app-download-grants.sql

insert into app_download_grants (phone_e164, percentage)
select distinct p.phone_e164, 20
from device_push_tokens d
join user_profiles p on p.user_id = d.user_id
where p.phone_e164 is not null
on conflict (phone_e164) do nothing;
