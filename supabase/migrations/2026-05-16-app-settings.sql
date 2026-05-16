-- Key-value site-wide settings. First key: pos_backup_mode (boolean) —
-- when true, online ordering cutoff matches physical close (22:30 BNE)
-- instead of the default 22:15 (which leaves 15min for staff to finish
-- the last cup). Operator toggles this from admin /members.

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT  -- admin identifier (ADMIN_EMAIL from HMAC session). Not a
                   -- FK to auth.users: admin auth runs on env creds, not Supabase auth.
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Read: public allowlist. Cart UI on the customer site reads effective ordering
-- state (the actual read happens server-side via service_role today, but a
-- public read policy keeps the door open if we ever fetch from the browser
-- client). Public-readable keys allowlist: add new keys here only when you've
-- confirmed they're safe to expose to anon. Server-side reads via service_role
-- bypass RLS and work for any key regardless.
CREATE POLICY "app_settings_read_public_keys"
  ON app_settings
  FOR SELECT
  USING (key IN ('pos_backup_mode'));

-- Write: service_role only. No INSERT/UPDATE/DELETE policy → denies anon
-- and authenticated. Admin endpoint uses getSupabaseAdmin() which is
-- service-role-keyed.

-- Seed + immediate switch-on. Re-running the migration is idempotent.
INSERT INTO app_settings (key, value, updated_by)
VALUES ('pos_backup_mode', 'true'::jsonb, 'migration-seed')
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value, updated_at = now();
