-- 2026-04-26: signup_channel column on user_profiles.
--
-- Distinguishes web-registered vs app-registered members for the
-- standalone admin dashboard at admin.mandybubbletea.com. Backfilled
-- from device_push_tokens because the column did not exist when these
-- users registered:
--   any push token  → 'app' (must have opened the RN app at least once)
--   no push token   → 'web' (best-effort default)
--
-- New rows MUST set this column from the client (web → 'web',
-- app → 'app'). Until the RN release ships, app-originated signups
-- arrive with NULL; the dashboard surfaces these as "Unknown".
-- Phase 2 migration adds NOT NULL after RN release ships.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS signup_channel TEXT;

ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_signup_channel_check;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_signup_channel_check
  CHECK (signup_channel IS NULL OR signup_channel IN ('web', 'app'));

UPDATE public.user_profiles up
SET signup_channel = CASE
  WHEN EXISTS (
    SELECT 1
    FROM public.device_push_tokens dpt
    WHERE dpt.user_id = up.user_id
  ) THEN 'app'
  ELSE 'web'
END
WHERE signup_channel IS NULL;
