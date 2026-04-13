# SMS OTP Verification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate account page access behind SMS verification code, trust the device after first verification.

**Architecture:** Three new API routes (`send-code`, `verify-code`, `check-token`) backed by Upstash Redis for OTP and device token storage, Twilio for SMS delivery. The account page state machine gains an OTP_INPUT step between phone entry and dashboard/signup. A new `OtpInput` component handles the 6-box code entry UI.

**Tech Stack:** Next.js 14 API routes, Twilio Node SDK, @upstash/redis, React

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/redis.ts` | Create | Upstash Redis client singleton |
| `src/lib/twilio.ts` | Create | Twilio client singleton + `sendOtp()` helper |
| `src/app/api/auth/send-code/route.ts` | Create | Generate OTP, rate limit, send SMS |
| `src/app/api/auth/verify-code/route.ts` | Create | Verify OTP, create device token, lookup customer |
| `src/app/api/auth/check-token/route.ts` | Create | Validate device token for auto-login |
| `src/components/account/OtpInput.tsx` | Create | 6-box code input with auto-advance, paste support |
| `src/app/account/page.tsx` | Modify | Add OTP_INPUT state, device token flow, split name fields |
| `src/app/api/customer/route.ts` | Modify | Accept `firstName`/`lastName` in addition to `name` |

---

### Task 1: Install Dependencies & Create Redis/Twilio Clients

**Files:**
- Create: `src/lib/redis.ts`
- Create: `src/lib/twilio.ts`

- [ ] **Step 1: Install packages**

```bash
cd ~/Github/mandys_bubble_tea
npm install twilio @upstash/redis
```

Expected: packages added to `package.json` dependencies.

- [ ] **Step 2: Create Redis client**

Create `src/lib/redis.ts`:

```typescript
import { Redis } from "@upstash/redis";

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});
```

- [ ] **Step 3: Create Twilio client + sendOtp helper**

Create `src/lib/twilio.ts`:

```typescript
import twilio from "twilio";

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!,
);

const FROM = process.env.TWILIO_PHONE_NUMBER!;

export async function sendOtp(to: string, code: string): Promise<void> {
  await client.messages.create({
    to,
    from: FROM,
    body: `Your Mandy's Bubble Tea verification code is: ${code}`,
  });
}
```

- [ ] **Step 4: Add env vars to `.env.local`**

Append to `.env.local` (values filled by user):

```
# Twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

# Upstash Redis
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/redis.ts src/lib/twilio.ts package.json package-lock.json
git commit -m "feat: add Twilio and Upstash Redis clients for SMS OTP"
```

---

### Task 2: POST /api/auth/send-code

**Files:**
- Create: `src/app/api/auth/send-code/route.ts`

- [ ] **Step 1: Create the route**

Create `src/app/api/auth/send-code/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { normalizeAuPhone } from "@/lib/phone";
import { redis } from "@/lib/redis";
import { sendOtp } from "@/lib/twilio";

const OTP_TTL = 300; // 5 minutes
const RATE_LIMIT = 3; // max sends per window
const RATE_TTL = 300; // 5-minute window

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const { phone } = (body ?? {}) as { phone?: unknown };
  if (typeof phone !== "string" || !phone.trim()) {
    return NextResponse.json(
      { ok: false, error: "Phone is required" },
      { status: 400 },
    );
  }

  const e164 = normalizeAuPhone(phone);
  if (!e164) {
    return NextResponse.json(
      { ok: false, error: "Invalid phone number" },
      { status: 400 },
    );
  }

  // Rate limit: max 3 sends per 5-minute window per phone.
  const rateKey = `otp:rate:${e164}`;
  const currentCount = await redis.incr(rateKey);
  if (currentCount === 1) {
    await redis.expire(rateKey, RATE_TTL);
  }
  if (currentCount > RATE_LIMIT) {
    return NextResponse.json(
      { ok: false, error: "Too many attempts, please try again later" },
      { status: 429 },
    );
  }

  // Generate 6-digit code.
  const code = String(Math.floor(100000 + Math.random() * 900000));

  // Store in Redis with TTL.
  await redis.set(`otp:${e164}`, code, { ex: OTP_TTL });

  // Send SMS via Twilio.
  try {
    await sendOtp(e164, code);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: `SMS send failed: ${message}` },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Smoke test with curl (requires env vars filled in)**

```bash
curl -X POST http://localhost:3000/api/auth/send-code \
  -H "Content-Type: application/json" \
  -d '{"phone":"YOUR_REAL_PHONE"}'
```

Expected: `{"ok":true}` and an SMS received.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/auth/send-code/route.ts
git commit -m "feat: add send-code API route with rate limiting"
```

---

### Task 3: POST /api/auth/verify-code

**Files:**
- Create: `src/app/api/auth/verify-code/route.ts`

- [ ] **Step 1: Create the route**

Create `src/app/api/auth/verify-code/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { normalizeAuPhone } from "@/lib/phone";
import { redis } from "@/lib/redis";
import { squareClient, ensureReferenceId } from "@/lib/square";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const { phone, code } = (body ?? {}) as {
    phone?: unknown;
    code?: unknown;
  };

  if (typeof phone !== "string" || !phone.trim()) {
    return NextResponse.json(
      { ok: false, error: "Phone is required" },
      { status: 400 },
    );
  }
  if (typeof code !== "string" || !code.trim()) {
    return NextResponse.json(
      { ok: false, error: "Code is required" },
      { status: 400 },
    );
  }

  const e164 = normalizeAuPhone(phone);
  if (!e164) {
    return NextResponse.json(
      { ok: false, error: "Invalid phone number" },
      { status: 400 },
    );
  }

  // Look up stored OTP.
  const storedCode = await redis.get<string>(`otp:${e164}`);
  if (!storedCode) {
    return NextResponse.json(
      { ok: false, error: "Code expired, please request a new one" },
      { status: 410 },
    );
  }
  if (storedCode !== code.trim()) {
    return NextResponse.json(
      { ok: false, error: "Invalid code" },
      { status: 401 },
    );
  }

  // Code matches — delete it so it can't be reused.
  await redis.del(`otp:${e164}`);

  // Generate device token for trusted-device flow.
  const deviceToken = crypto.randomUUID();
  await redis.set(`device:${deviceToken}`, e164);

  // Look up customer in Square.
  try {
    const search = await squareClient.customers.search({
      limit: BigInt(1),
      query: {
        filter: {
          phoneNumber: { exact: e164 },
        },
      },
    });

    const existing = search.customers?.[0];
    if (existing?.id) {
      await ensureReferenceId(existing.id, existing.referenceId, e164);
      return NextResponse.json({
        ok: true,
        deviceToken,
        found: true,
        customerId: existing.id,
        givenName: existing.givenName ?? null,
        familyName: existing.familyName ?? null,
        phoneE164: e164,
      });
    }

    // Phone verified but no Square customer yet — new user.
    return NextResponse.json({
      ok: true,
      deviceToken,
      found: false,
      phoneE164: e164,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/auth/verify-code/route.ts
git commit -m "feat: add verify-code API route with device token"
```

---

### Task 4: POST /api/auth/check-token

**Files:**
- Create: `src/app/api/auth/check-token/route.ts`

- [ ] **Step 1: Create the route**

Create `src/app/api/auth/check-token/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { squareClient, ensureReferenceId } from "@/lib/square";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const { deviceToken } = (body ?? {}) as { deviceToken?: unknown };
  if (typeof deviceToken !== "string" || !deviceToken.trim()) {
    return NextResponse.json({ ok: true, valid: false });
  }

  const e164 = await redis.get<string>(`device:${deviceToken}`);
  if (!e164) {
    return NextResponse.json({ ok: true, valid: false });
  }

  // Token is valid — look up customer in Square.
  try {
    const search = await squareClient.customers.search({
      limit: BigInt(1),
      query: {
        filter: {
          phoneNumber: { exact: e164 },
        },
      },
    });

    const existing = search.customers?.[0];
    if (existing?.id) {
      await ensureReferenceId(existing.id, existing.referenceId, e164);
      return NextResponse.json({
        ok: true,
        valid: true,
        customerId: existing.id,
        givenName: existing.givenName ?? null,
        familyName: existing.familyName ?? null,
        phoneE164: e164,
      });
    }

    // Token valid but customer not in Square (edge case: deleted from Square).
    return NextResponse.json({
      ok: true,
      valid: true,
      phoneE164: e164,
      customerId: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/auth/check-token/route.ts
git commit -m "feat: add check-token API route for auto-login"
```

---

### Task 5: Update /api/customer to Accept firstName/lastName

**Files:**
- Modify: `src/app/api/customer/route.ts`

- [ ] **Step 1: Update the route to accept firstName/lastName**

In `src/app/api/customer/route.ts`, change the body parsing to accept either the new `firstName`/`lastName` fields or the existing `name` field for backwards compatibility:

Replace the body destructuring and name validation (lines 21-31):

```typescript
  const { name, firstName, lastName, phone } = (body ?? {}) as {
    name?: unknown;
    firstName?: unknown;
    lastName?: unknown;
    phone?: unknown;
  };

  // Support both {firstName, lastName} and legacy {name} format.
  let givenName: string;
  let familyName: string | undefined;

  if (typeof firstName === "string" && firstName.trim()) {
    givenName = firstName.trim();
    familyName = typeof lastName === "string" && lastName.trim()
      ? lastName.trim()
      : undefined;
  } else if (typeof name === "string" && name.trim()) {
    const parts = name.trim().split(/\s+/);
    givenName = parts[0];
    familyName = parts.slice(1).join(" ") || undefined;
  } else {
    return NextResponse.json(
      { ok: false, error: "Name is required" },
      { status: 400 },
    );
  }
```

Remove the old name-splitting logic on line 47 (`const [givenName, ...rest] = ...`) since it's now handled above.

- [ ] **Step 2: Verify build passes**

```bash
npm run build
```

Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/customer/route.ts
git commit -m "feat: accept firstName/lastName in customer create API"
```

---

### Task 6: OtpInput Component

**Files:**
- Create: `src/components/account/OtpInput.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/account/OtpInput.tsx`:

```tsx
"use client";

import { useRef, useCallback, KeyboardEvent, ClipboardEvent } from "react";
import { BRAND } from "@/lib/constants";

const CODE_LENGTH = 6;

export function OtpInput({
  value,
  onChange,
  disabled,
  error,
}: {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  error?: boolean;
}) {
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  const focusIndex = useCallback((i: number) => {
    inputsRef.current[i]?.focus();
  }, []);

  const handleChange = useCallback(
    (i: number, digit: string) => {
      if (!/^\d?$/.test(digit)) return;
      const chars = value.split("");
      // Pad to length so indices work.
      while (chars.length < CODE_LENGTH) chars.push("");
      chars[i] = digit;
      const next = chars.join("").slice(0, CODE_LENGTH);
      onChange(next);
      if (digit && i < CODE_LENGTH - 1) {
        focusIndex(i + 1);
      }
    },
    [value, onChange, focusIndex],
  );

  const handleKeyDown = useCallback(
    (i: number, e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Backspace" && !value[i] && i > 0) {
        focusIndex(i - 1);
      }
    },
    [value, focusIndex],
  );

  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLInputElement>) => {
      e.preventDefault();
      const pasted = e.clipboardData
        .getData("text")
        .replace(/\D/g, "")
        .slice(0, CODE_LENGTH);
      if (pasted) {
        onChange(pasted);
        focusIndex(Math.min(pasted.length, CODE_LENGTH - 1));
      }
    },
    [onChange, focusIndex],
  );

  return (
    <div className="flex justify-center gap-2">
      {Array.from({ length: CODE_LENGTH }).map((_, i) => (
        <input
          key={i}
          ref={(el) => { inputsRef.current[i] = el; }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={value[i] ?? ""}
          disabled={disabled}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={i === 0 ? handlePaste : undefined}
          autoFocus={i === 0}
          className="h-13 w-11 rounded-lg border-2 text-center text-xl font-bold outline-none transition-colors disabled:opacity-50"
          style={{
            borderColor: error
              ? "#ef4444"
              : value[i]
                ? BRAND.primaryColor
                : "#d4d4d8",
          }}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/account/OtpInput.tsx
git commit -m "feat: add OtpInput 6-box verification code component"
```

---

### Task 7: Refactor Account Page — Add OTP Flow

**Files:**
- Modify: `src/app/account/page.tsx`

This is the biggest task. The account page currently has states: phone input → (signup name | dashboard). We add OTP_INPUT between phone input and the rest, plus auto-login via device token.

- [ ] **Step 1: Add new state types and constants**

At the top of `src/app/account/page.tsx`, after the existing imports, add:

```typescript
import { OtpInput } from "@/components/account/OtpInput";
```

Change the `STORAGE_KEY` constant and add new ones:

```typescript
const STORAGE_KEY = "mbt:account:phone";
const DEVICE_TOKEN_KEY = "mbt:account:deviceToken";
const RESEND_COOLDOWN = 60; // seconds
```

- [ ] **Step 2: Add OTP state variables to AccountPage**

Inside the `AccountPage` component, add new state variables after the existing ones:

```typescript
  const [otpPhone, setOtpPhone] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [otpError, setOtpError] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);
```

- [ ] **Step 3: Replace loadAccount to send OTP instead of direct lookup**

Replace the `loadAccount` function with a `sendCode` function:

```typescript
  const sendCode = useCallback(async (phone: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "Failed to send code");
      }
      setOtpPhone(phone);
      setOtpCode("");
      setOtpError(false);
      setResendTimer(RESEND_COOLDOWN);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);
```

- [ ] **Step 4: Add verifyCode function**

Add after `sendCode`:

```typescript
  const verifyCode = useCallback(
    async (phone: string, code: string) => {
      setLoading(true);
      setError(null);
      setOtpError(false);
      try {
        const res = await fetch("/api/auth/verify-code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone, code }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          if (res.status === 401) {
            setOtpError(true);
            setLoading(false);
            return;
          }
          throw new Error(json.error ?? "Verification failed");
        }

        // Store device token.
        window.localStorage.setItem(DEVICE_TOKEN_KEY, json.deviceToken);

        if (json.found) {
          // Existing customer — go straight to dashboard.
          await hydrateDashboard(
            json.customerId,
            json.phoneE164,
            json.givenName,
            json.familyName,
          );
          setOtpPhone(null);
        } else {
          // New user — need name.
          setSignupPhone(json.phoneE164);
          setOtpPhone(null);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [hydrateDashboard],
  );
```

- [ ] **Step 5: Add resend timer effect**

Add a `useEffect` for the resend countdown:

```typescript
  useEffect(() => {
    if (resendTimer <= 0) return;
    const id = setTimeout(() => setResendTimer((t) => t - 1), 1000);
    return () => clearTimeout(id);
  }, [resendTimer]);
```

- [ ] **Step 6: Replace the mount useEffect for auto-login via device token**

Replace the existing `useEffect` that reads from localStorage:

```typescript
  useEffect(() => {
    const token = window.localStorage.getItem(DEVICE_TOKEN_KEY);
    if (token) {
      setLoading(true);
      fetch("/api/auth/check-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceToken: token }),
      })
        .then((res) => res.json())
        .then(async (json) => {
          if (json.ok && json.valid && json.customerId) {
            await hydrateDashboard(
              json.customerId,
              json.phoneE164,
              json.givenName,
              json.familyName,
            );
          } else {
            // Token invalid — clear it.
            window.localStorage.removeItem(DEVICE_TOKEN_KEY);
            window.localStorage.removeItem(STORAGE_KEY);
          }
        })
        .catch(() => {
          window.localStorage.removeItem(DEVICE_TOKEN_KEY);
          window.localStorage.removeItem(STORAGE_KEY);
        })
        .finally(() => {
          setLoading(false);
          setHydrated(true);
        });
    } else {
      setHydrated(true);
    }
  }, [hydrateDashboard]);
```

- [ ] **Step 7: Update handleSubmit**

Replace the `handleSubmit` function:

```typescript
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (signupPhone) {
      if (!nameInput.firstName.trim() || !nameInput.lastName.trim()) return;
      void signUp(nameInput, signupPhone);
      return;
    }
    if (!phoneInput.trim()) return;
    void sendCode(phoneInput.trim());
  }
```

- [ ] **Step 8: Update handleSignOut to clear device token**

Update `handleSignOut`:

```typescript
  function handleSignOut() {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(DEVICE_TOKEN_KEY);
    setData(null);
    setPhoneInput("");
    setNameInput({ firstName: "", lastName: "" });
    setSignupPhone(null);
    setOtpPhone(null);
    setOtpCode("");
    setError(null);
  }
```

- [ ] **Step 9: Update signUp to use firstName/lastName**

Change the `nameInput` state from `string` to `{ firstName: string; lastName: string }`:

```typescript
  const [nameInput, setNameInput] = useState({ firstName: "", lastName: "" });
```

Update the `signUp` function:

```typescript
  const signUp = useCallback(
    async (name: { firstName: string; lastName: string }, phone: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/customer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            firstName: name.firstName,
            lastName: name.lastName,
            phone,
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          throw new Error(json.error ?? "Sign up failed");
        }

        await hydrateDashboard(
          json.customerId,
          json.phoneE164 ?? phone,
          name.firstName,
          name.lastName,
        );
        setSignupPhone(null);
        setNameInput({ firstName: "", lastName: "" });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [hydrateDashboard],
  );
```

- [ ] **Step 10: Update the render — add OTP screen**

In the return JSX, add the OTP_INPUT state between the phone form and signup/dashboard. Replace the ternary:

```tsx
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
      {!hydrated || (!data && loading && !otpPhone) ? (
        <LoadingSpinner />
      ) : otpPhone ? (
        <OtpScreen
          phone={otpPhone}
          code={otpCode}
          onCodeChange={setOtpCode}
          onVerify={() => verifyCode(otpPhone, otpCode)}
          onResend={() => sendCode(otpPhone)}
          onBack={() => {
            setOtpPhone(null);
            setOtpCode("");
            setError(null);
            setOtpError(false);
          }}
          resendTimer={resendTimer}
          loading={loading}
          error={error}
          otpError={otpError}
        />
      ) : !data ? (
        <SignInForm
          phone={phoneInput}
          onPhoneChange={setPhoneInput}
          name={nameInput}
          onNameChange={setNameInput}
          signupMode={signupPhone !== null}
          onBackToPhone={() => {
            setSignupPhone(null);
            setNameInput({ firstName: "", lastName: "" });
            setError(null);
          }}
          onSubmit={handleSubmit}
          loading={loading}
          error={error}
        />
      ) : (
        <AccountDashboard
          data={data}
          onSignOut={handleSignOut}
          refreshing={loading}
          error={error}
        />
      )}
    </main>
  );
```

- [ ] **Step 11: Create OtpScreen component**

Add a new function component in the same file, after `SignInForm`:

```tsx
function OtpScreen({
  phone,
  code,
  onCodeChange,
  onVerify,
  onResend,
  onBack,
  resendTimer,
  loading,
  error,
  otpError,
}: {
  phone: string;
  code: string;
  onCodeChange: (code: string) => void;
  onVerify: () => void;
  onResend: () => void;
  onBack: () => void;
  resendTimer: number;
  loading: boolean;
  error: string | null;
  otpError: boolean;
}) {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-black/10 bg-white p-5 shadow-sm sm:p-8">
      <h2 className="mb-2 text-2xl font-bold text-zinc-900">
        Enter Verification Code
      </h2>
      <p className="mb-6 text-sm leading-relaxed text-zinc-600">
        Sent to{" "}
        <span className="font-medium text-zinc-800">{phone}</span>
      </p>

      <div className="mb-5">
        <OtpInput
          value={code}
          onChange={onCodeChange}
          disabled={loading}
          error={otpError}
        />
        {otpError && (
          <p className="mt-2 text-center text-sm text-red-600">
            Invalid code, please try again
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={onVerify}
        disabled={loading || code.replace(/\s/g, "").length < 6}
        className="w-full rounded-full py-3.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        style={{ backgroundColor: BRAND.primaryColor }}
      >
        {loading ? "Verifying…" : "Verify →"}
      </button>

      <div className="mt-4 text-center text-sm">
        <span className="text-zinc-500">Didn't receive it? </span>
        {resendTimer > 0 ? (
          <span className="text-zinc-400">
            Resend in {resendTimer}s
          </span>
        ) : (
          <button
            type="button"
            onClick={onResend}
            disabled={loading}
            className="font-semibold transition hover:opacity-80"
            style={{ color: BRAND.primaryColor }}
          >
            Resend Code
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={onBack}
        className="mt-3 block w-full text-center text-xs text-zinc-500 underline-offset-2 hover:underline"
      >
        ← Use a different number
      </button>

      {error && !otpError && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 12: Update SignInForm for firstName/lastName**

Update `SignInForm` props type to use `{ firstName: string; lastName: string }` for `name`/`onNameChange`, and update the signup mode section:

Props change:
```typescript
  name: { firstName: string; lastName: string };
  onNameChange: (v: { firstName: string; lastName: string }) => void;
```

Replace the signup mode input fields (the single name input block) with:

```tsx
        {signupMode ? (
          <div className="space-y-3">
            <div
              className="mb-3 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700"
            >
              <span>✓</span> Phone verified
            </div>
            <div>
              <span className="mb-2 block text-sm font-semibold text-zinc-800">
                First Name
              </span>
              <input
                type="text"
                value={name.firstName}
                onChange={(e) =>
                  onNameChange({ ...name, firstName: e.target.value })
                }
                placeholder="First name"
                autoComplete="given-name"
                autoFocus
                required
                className="w-full rounded-full border border-black/15 bg-white px-4 py-2.5 text-sm outline-none focus:border-black/40"
              />
            </div>
            <div>
              <span className="mb-2 block text-sm font-semibold text-zinc-800">
                Last Name
              </span>
              <input
                type="text"
                value={name.lastName}
                onChange={(e) =>
                  onNameChange({ ...name, lastName: e.target.value })
                }
                placeholder="Last name"
                autoComplete="family-name"
                required
                className="w-full rounded-full border border-black/15 bg-white px-4 py-2.5 text-sm outline-none focus:border-black/40"
              />
            </div>
            <button
              type="button"
              onClick={onBackToPhone}
              className="text-xs text-zinc-500 underline-offset-2 hover:underline"
            >
              ← Use a different phone number
            </button>
          </div>
```

Update the phone input state button text from `"View My Account →"` to `"Send Verification Code →"`.

Update the helper text below the form (before Terms of Service):

```tsx
      <p className="mt-3 text-center text-xs text-zinc-400">
        {signupMode
          ? ""
          : "We'll send a 6-digit code to verify your number"}
      </p>
```

- [ ] **Step 13: Verify build passes**

```bash
npm run build
```

Expected: no type errors.

- [ ] **Step 14: Commit**

```bash
git add src/app/account/page.tsx src/components/account/OtpInput.tsx
git commit -m "feat: add SMS OTP verification to account page"
```

---

### Task 8: End-to-End Manual Test

- [ ] **Step 1: Fill in env vars**

Ensure `.env.local` has valid Twilio + Upstash credentials.

- [ ] **Step 2: Start dev server**

```bash
npm run dev
```

- [ ] **Step 3: Test login flow (existing customer)**

1. Go to `/account`
2. Enter a phone number that exists in Square
3. Click "Send Verification Code"
4. Enter the received 6-digit code
5. Verify: dashboard loads with loyalty + orders

- [ ] **Step 4: Test signup flow (new phone)**

1. Sign out
2. Enter a phone number NOT in Square
3. Verify code → should show first name + last name form
4. Submit → dashboard loads (empty)

- [ ] **Step 5: Test auto-login (trusted device)**

1. Close tab, reopen `/account`
2. Should auto-login without entering phone or code

- [ ] **Step 6: Test sign-out**

1. Click sign out
2. Should clear everything, show phone input again
3. Reopen in new tab → should NOT auto-login

- [ ] **Step 7: Test error cases**

1. Wrong code → "Invalid code" error, boxes turn red
2. Wait 5 min → "Code expired" message
3. Resend 4 times quickly → "Too many attempts" error

- [ ] **Step 8: Final commit if any fixes needed**

```bash
git add -u
git commit -m "fix: address issues found in OTP e2e testing"
```
