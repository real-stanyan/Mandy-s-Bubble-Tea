-- delivery_enabled (boolean) — boss kill-switch for delivery ordering on web
-- AND the App (they share /api/orders, which gates on this server-side). The
-- operator toggles it from admin /members (the DeliveryPill).
--
-- Why this migration exists: without an explicit row the two apps disagree on a
-- missing row — the web helper falls back to NEXT_PUBLIC_DELIVERY_ENABLED while
-- the Admin pill reads it as OFF. Seeding an explicit row makes both agree, so
-- the env fallback only ever fires on a genuine Supabase outage (its intent).

-- Read: extend the public allowlist to include delivery_enabled (parity with
-- pos_backup_mode). Server reads use service_role and bypass RLS regardless;
-- this keeps the door open for a future browser-side read and matches the
-- documented pattern.
DROP POLICY IF EXISTS "app_settings_read_public_keys" ON app_settings;
CREATE POLICY "app_settings_read_public_keys"
  ON app_settings
  FOR SELECT
  USING (key IN ('pos_backup_mode', 'delivery_enabled'));

-- Seed. DO NOTHING (NOT DO UPDATE): this must never clobber a value the boss has
-- already set from the Admin pill. It only creates the row when absent.
--
-- Seed value = true, because delivery is currently LIVE in prod
-- (NEXT_PUBLIC_DELIVERY_ENABLED=true). Seeding true keeps the current effective
-- behaviour unchanged while making the Admin pill and the web read agree on an
-- explicit row. (Seeding false here would have turned live delivery OFF on
-- deploy — confirmed with the operator that delivery is on.)
INSERT INTO app_settings (key, value, updated_by)
VALUES ('delivery_enabled', 'true'::jsonb, 'migration-seed')
ON CONFLICT (key) DO NOTHING;
