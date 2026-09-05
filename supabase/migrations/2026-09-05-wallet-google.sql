-- Google Wallet member card shares the Apple pass row (same serial, same
-- member number). Two timestamps track the Android side:
--   google_issued_at  — a save JWT was minted; loyalty re-push now also
--                       updates the Google object
--   google_saved_at   — the App reported RESULT_OK from Google's save sheet
ALTER TABLE wallet_passes
  ADD COLUMN IF NOT EXISTS google_issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS google_saved_at  timestamptz;
