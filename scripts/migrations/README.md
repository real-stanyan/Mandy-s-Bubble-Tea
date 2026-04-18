# Supabase migrations

These are plain SQL files, not a framework. Run them once each in
Supabase Dashboard → SQL Editor, in filename order.

## How to apply

1. Open https://supabase.com/dashboard/project/fsvtwivogyebugqhmjjy/sql
2. Paste the file contents
3. Run

## Files

- `001_user_profiles.sql` — auth.users ↔ Square customer mapping table
  used by the Supabase Auth rollout. Also enables RLS.

## Supabase Auth Dashboard setup checklist

After applying the migrations, verify these settings in the Dashboard:

### Auth → Providers
- **Phone**: enable. Under SMS provider pick **Twilio Verify**. Fill:
  - Twilio Account SID = `TWILIO_ACCOUNT_SID` from `.env.local`
  - Twilio Auth Token = `TWILIO_AUTH_TOKEN`
  - Twilio Message Service SID = *your Verify Service SID*
    (Supabase uses this field for Verify Services; the label is
    misleading)
  - Message template / sender — defaults are fine
- **Apple**: already configured during OAuth setup. Verify Client IDs
  field contains both `com.mandysbubbletea.web.auth` and
  `com.mandysbubbletea.app`.
- **Google**: already configured. Verify Authorized Client IDs field
  contains the iOS client ID.

### Auth → URL Configuration
- Site URL: `https://mandybubbletea.com`
- Redirect URLs (allow list, newline-separated):
  ```
  https://mandybubbletea.com/auth/callback
  https://www.mandybubbletea.com/auth/callback
  http://localhost:3000/auth/callback
  mandybubbletea://auth/callback
  ```

### Auth → Email Templates
Not used for this rollout — all identity providers give us email +
phone, never password-based. Leave defaults.
