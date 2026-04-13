# SMS OTP Verification — Design Spec

## Overview

Add SMS verification code (OTP) to the account page login/signup flow. Currently any visitor can enter any phone number and see that person's loyalty stars and order history. This feature gates account access behind a one-time SMS verification per device.

## Decision Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| SMS provider | Twilio (direct SMS, not Verify) | Full control, simpler, cheaper at low volume |
| OTP storage | Upstash Redis (Vercel KV) | Serverless-compatible, free tier sufficient (10K cmd/day) |
| OTP format | 6 digits, 5 min TTL | Industry standard |
| Trust model | Device token in localStorage, no expiry | Convenience for a bubble tea shop; clears on sign-out |
| When to verify | First login + signup on a device | Returning verified devices skip OTP |
| Rate limit | Max 3 sends per phone per 5 min | Prevent abuse without external service |
| Name fields | Separate first name / last name | User requirement |

## Architecture

### New API Routes

#### `POST /api/auth/send-code`

**Request:**
```json
{ "phone": "0400000000" }
```

**Logic:**
1. Normalize phone via `normalizeAuPhone()` → E.164
2. Rate limit check: Redis key `otp:rate:{e164}` — increment, TTL 300s. If > 3, reject.
3. Generate 6-digit code: `Math.floor(100000 + Math.random() * 900000)`
4. Store in Redis: key `otp:{e164}`, value = code, TTL 300s (5 min)
5. Send SMS via Twilio: `"Your Mandy's Bubble Tea code is: {code}"`
6. Return `{ ok: true }`

**Errors:**
- 400: invalid phone
- 429: rate limited ("Too many attempts, please try again later")
- 502: Twilio send failure

#### `POST /api/auth/verify-code`

**Request:**
```json
{ "phone": "0400000000", "code": "385291" }
```

**Logic:**
1. Normalize phone → E.164
2. Get stored code from Redis: key `otp:{e164}`
3. If no key (expired) → 410 "Code expired, please request a new one"
4. If code doesn't match → 401 "Invalid code"
5. On match:
   - Delete OTP key from Redis
   - Generate deviceToken: `crypto.randomUUID()`
   - Store in Redis: key `device:{deviceToken}`, value = e164 (no TTL)
   - Look up customer in Square by phone (same logic as current `/api/customer/lookup`)
   - Return `{ ok: true, deviceToken, found: bool, customerId?, givenName?, familyName?, phoneE164 }`

#### `POST /api/auth/check-token`

**Request:**
```json
{ "deviceToken": "uuid-here" }
```

**Logic:**
1. Look up Redis: key `device:{deviceToken}`
2. If not found → `{ ok: true, valid: false }`
3. If found → return phone, then look up customer in Square
4. Return `{ ok: true, valid: true, customerId?, givenName?, familyName?, phoneE164 }`

### New Dependencies

| Package | Purpose |
|---------|---------|
| `twilio` | SMS sending |
| `@upstash/redis` | Serverless Redis for OTP + device token storage |

### New Environment Variables

| Variable | Description |
|----------|-------------|
| `TWILIO_ACCOUNT_SID` | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | Sender phone number (AU or toll-free) |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis auth token |

### Redis Key Schema

| Key pattern | Value | TTL |
|-------------|-------|-----|
| `otp:{e164}` | 6-digit code string | 300s |
| `otp:rate:{e164}` | send count (int) | 300s |
| `device:{uuid}` | E.164 phone string | none |

## UI Flow

### State Machine

```
INIT → has deviceToken in localStorage? → check-token API
  ├─ valid → load account → DASHBOARD
  └─ invalid → clear token → PHONE_INPUT

PHONE_INPUT → submit phone → send-code API → OTP_INPUT
OTP_INPUT → submit code → verify-code API
  ├─ success + existing customer → store deviceToken → DASHBOARD
  ├─ success + new customer → store deviceToken → SIGNUP_NAME
  └─ failure → show error, stay on OTP_INPUT
OTP_INPUT → "back" → PHONE_INPUT

SIGNUP_NAME → submit first name + last name → create customer API → DASHBOARD
```

### Step 1: Phone Input

- Same form as current, but button text changes to **"Send Verification Code →"**
- Helper text: "We'll send a 6-digit code to verify your number"
- On submit: call `/api/auth/send-code`, then transition to OTP_INPUT

### Step 2: OTP Input

- Title: "Enter Verification Code"
- Subtitle: "Sent to +61 400 000 000" (show the formatted number)
- **6 individual input boxes**, each holds 1 digit:
  - Auto-focus first box
  - Auto-advance to next on digit entry
  - Support paste of full 6-digit string
  - Backspace moves to previous box
  - Boxes with input show brand border color (`#C43A10`)
- **Verify button**: enabled when all 6 digits filled
- **Resend link**: "Didn't receive it? Resend Code (available in 60s)"
  - 60-second countdown timer, greyed out until 0
  - On click: re-call `/api/auth/send-code`
- **Back link**: "← Use a different number" → returns to PHONE_INPUT
- **Error state**: boxes turn red border, message "Invalid code, please try again"
- **Expired state**: message "Code expired, please request a new one" + auto-show resend

### Step 3a: Signup (New User)

- Title: "Finish Signing Up"
- Subtitle: "Looks like you're new here!"
- Green verified badge: "✓ Phone verified: +61 400 000 000"
- **Two input fields**:
  - First Name (placeholder: "First name", required)
  - Last Name (placeholder: "Last name", required)
- Button: "Create Account →"
- On submit: call existing `/api/customer` with `{ firstName, lastName, phone }`
- The `/api/customer` route needs minor update to accept `firstName`/`lastName` instead of single `name`

### Step 3b: Dashboard (Existing User)

- Same as current dashboard, no changes needed
- deviceToken stored in localStorage under key `mbt:account:deviceToken`
- Phone stored under existing key `mbt:account:phone`

### Auto-Login (Returning Verified Device)

- On page mount: check localStorage for `mbt:account:deviceToken`
- If present: call `/api/auth/check-token`
  - Valid: auto-load account (same as current flow with stored phone)
  - Invalid: clear localStorage, show PHONE_INPUT

### Sign Out

- Current behavior plus: delete `mbt:account:deviceToken` from localStorage
- Server-side: call Redis DEL on `device:{token}` (optional, nice-to-have)

## Security

- **OTP brute-force**: 6 digits = 1M combinations. With rate limit of 3 sends per 5 min and 5 min expiry, brute force is impractical.
- **Device token**: UUID v4 (122 bits of entropy), unguessable.
- **No server session**: stateless — Redis holds the mapping, client holds the token. Simple and serverless-friendly.
- **Phone enumeration**: The send-code endpoint always returns success (doesn't reveal whether a phone exists in Square). The verify-code response indicates new vs existing after verification.

## Files to Create/Modify

### New files:
- `src/lib/redis.ts` — Upstash Redis client singleton
- `src/lib/twilio.ts` — Twilio client singleton
- `src/app/api/auth/send-code/route.ts`
- `src/app/api/auth/verify-code/route.ts`
- `src/app/api/auth/check-token/route.ts`
- `src/components/account/OtpInput.tsx` — 6-box OTP input component

### Modified files:
- `src/app/account/page.tsx` — add OTP_INPUT state, refactor state machine
- `src/app/api/customer/route.ts` — accept `firstName`/`lastName` fields
