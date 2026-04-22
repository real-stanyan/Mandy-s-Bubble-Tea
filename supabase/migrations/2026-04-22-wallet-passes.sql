-- Apple Wallet membership card: pass registry + device registrations
--                                + short-lived exchange tokens for app → browser handoff

-- Sequence for MB-xxxx numbers; starts at 4182 per handoff design precedent
CREATE SEQUENCE IF NOT EXISTS mandy_member_seq START 4182 INCREMENT 1;

CREATE TABLE IF NOT EXISTS wallet_passes (
  serial_number   text PRIMARY KEY,
  customer_id     text NOT NULL UNIQUE,
  member_number   text NOT NULL UNIQUE,
  auth_token      text NOT NULL,
  pass_type_id    text NOT NULL,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wallet_passes_customer_idx ON wallet_passes (customer_id);

CREATE TABLE IF NOT EXISTS wallet_pass_devices (
  device_library_id text NOT NULL,
  serial_number     text NOT NULL REFERENCES wallet_passes(serial_number) ON DELETE CASCADE,
  push_token        text NOT NULL,
  registered_at     timestamptz DEFAULT now(),
  PRIMARY KEY (device_library_id, serial_number)
);
CREATE INDEX IF NOT EXISTS wallet_pass_devices_serial_idx ON wallet_pass_devices (serial_number);

CREATE TABLE IF NOT EXISTS wallet_exchange_tokens (
  token        text PRIMARY KEY,
  customer_id  text NOT NULL,
  created_at   timestamptz DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz
);
CREATE INDEX IF NOT EXISTS wallet_exchange_tokens_customer_idx ON wallet_exchange_tokens (customer_id);

-- Wrapper so Supabase JS client can reserve the next member number via rpc()
CREATE OR REPLACE FUNCTION next_member_number()
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT nextval('mandy_member_seq');
$$;
