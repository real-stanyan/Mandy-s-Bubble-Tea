"use client";

import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { BRAND } from "@/lib/constants";
import { useAuth } from "@/components/auth/AuthProvider";
import { OtpInput } from "@/components/account/OtpInput";
import { PhoneConflictDialog } from "@/components/auth/PhoneConflictDialog";

const PHONE_CONFLICT_PREFIX = "This phone number is already linked";

// Single reusable sign-in surface. Renders three entry points —
// Continue with Apple, Continue with Google, Enter phone number —
// plus the phone-OTP verification screen and the name-capture screen
// (shown once when a brand-new customer finishes OAuth). Used by the
// Account page and by the Checkout page when the visitor isn't yet
// signed in.
//
// The actual auth state lives in <AuthProvider>; this component is
// purely presentational and state-machine glue around it.

type Stage =
  | { kind: "chooser" }
  | { kind: "phone" }
  | { kind: "otp"; phone: string }
  | { kind: "name" };

// Sign in with Apple is only a good experience on devices that can
// pop Apple's native AuthenticationServices sheet (Face ID / Touch ID
// / iCloud-linked approval): iPhone, iPad, and Mac Safari. Everywhere
// else the user gets dropped onto appleid.apple.com's password form
// + 2FA, which is worse than Google or Phone OTP — so we hide the
// button. iPadOS 13+ reports itself as Macintosh in the UA string,
// but has touch points > 1; desktop Macs have touch points === 0.
function isAppleNativeSignInDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  const platform = (navigator as unknown as { platform?: string }).platform;
  const isMac = platform === "MacIntel" || /Macintosh/.test(ua);
  if (!isMac) return false;
  // iPad on iPadOS 13+ pretending to be Mac.
  if (navigator.maxTouchPoints > 1) return true;
  // Mac Safari only — exclude Chrome/Firefox/Edge/Opera/Chromium which
  // also put "Safari" in their UA string.
  const isSafariOnMac =
    /Safari/.test(ua) &&
    !/Chrome|Chromium|CriOS|FxiOS|Firefox|Edg\/|OPR\//.test(ua);
  return isSafariOnMac;
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (digits.startsWith("+")) return digits.length >= 8 ? digits : null;
  if (digits.startsWith("0")) return `+61${digits.slice(1)}`;
  if (digits.length >= 9 && digits.length <= 11) return `+61${digits}`;
  return null;
}

/**
 * Pull a first/last name out of the Supabase session's user_metadata
 * when the OAuth provider already told us who this person is. Google
 * returns `given_name` + `family_name` (and a `full_name`); Apple
 * returns `full_name` / `name` on the first sign-in only if the user
 * chose to share it. Phone-OTP sign-ins have no metadata, so this
 * returns null and the UI falls back to the name-capture form.
 */
function extractNameFromMetadata(
  user: User | null,
): { firstName: string; lastName?: string } | null {
  if (!user) return null;
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const given =
    typeof meta.given_name === "string" ? meta.given_name.trim() : "";
  const family =
    typeof meta.family_name === "string" ? meta.family_name.trim() : "";
  if (given) return { firstName: given, lastName: family || undefined };
  const full =
    typeof meta.full_name === "string"
      ? meta.full_name.trim()
      : typeof meta.name === "string"
        ? meta.name.trim()
        : "";
  if (full) {
    const parts = full.split(/\s+/);
    return {
      firstName: parts[0] ?? "",
      lastName: parts.slice(1).join(" ") || undefined,
    };
  }
  return null;
}

export function SignInCard({
  heading = "Sign in to Mandy's",
  subheading = "Loyalty stars, orders, and your welcome discount — all in one place.",
  onComplete,
}: {
  heading?: string;
  subheading?: string;
  onComplete?: () => void;
}) {
  const auth = useAuth();
  const [stage, setStage] = useState<Stage>({ kind: "chooser" });
  const [phoneInput, setPhoneInput] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoSignupRef = useRef(false);
  // Default to false so server-rendered HTML matches the first client
  // render; flip to true after mount on devices that can use Apple's
  // native sheet. Hiding the button is better than showing one that
  // silently drops non-Apple users into a password-form mess.
  const [showApple, setShowApple] = useState(false);
  const [phoneConflictOpen, setPhoneConflictOpen] = useState(false);
  useEffect(() => {
    setShowApple(isAppleNativeSignInDevice());
  }, []);

  // After verifying OTP / finishing OAuth, Supabase gives us a session
  // but the user may still need to complete signup. OAuth (Apple/Google)
  // leaves the session phone-less, so route those through the phone
  // linking flow first; only after a phone is attached do we go to the
  // name step. Phone-only sign-ins land here already with a phone.
  if (auth.session && !auth.profile) {
    if (!auth.user?.phone && stage.kind !== "phone" && stage.kind !== "otp") {
      setStage({ kind: "phone" });
    } else if (auth.user?.phone && stage.kind !== "name") {
      setStage({ kind: "name" });
    }
  } else if (!auth.session && stage.kind === "name") {
    // Session dropped while we were on the name step (e.g. server-side
    // self-heal purged the account because its Square customer was
    // deleted). Pull the UI back to the chooser instead of leaving the
    // name form orphaned on screen.
    setStage({ kind: "chooser" });
  }

  // Google and (first-time) Apple sign-ins give us the user's name
  // straight from the ID token. When we have it, POST to
  // complete-signup immediately and skip the name form entirely.
  // Phone-OTP users have no metadata here → they still see the form.
  useEffect(() => {
    if (autoSignupRef.current) return;
    if (stage.kind !== "name") return;
    if (auth.profile) return;
    const metaName = extractNameFromMetadata(auth.user);
    if (!metaName) return;
    autoSignupRef.current = true;
    setLoading(true);
    setError(null);
    auth
      .completeSignup(metaName)
      .then(() => onComplete?.())
      .catch((err) => {
        // Let the user fix it manually on retry.
        autoSignupRef.current = false;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, [stage.kind, auth, onComplete]);

  async function handleApple() {
    setError(null);
    try {
      await auth.signInWithApple();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleGoogle() {
    setError(null);
    try {
      await auth.signInWithGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  // Back from phone/otp needs to drop the OAuth session, otherwise the
  // render-time guard ("session && !profile && !user.phone → phone
  // stage") immediately re-forwards us and the button looks dead. No
  // session (pure phone flow) means a plain stage change is fine.
  async function handleBackToChooser() {
    setError(null);
    setPhoneInput("");
    setOtpCode("");
    if (auth.session) {
      try {
        await auth.signOut();
      } catch {
        // Ignore — we still want to surface the chooser.
      }
    }
    setStage({ kind: "chooser" });
  }

  async function handleSendOtp() {
    setError(null);
    const e164 = normalizePhone(phoneInput.trim());
    if (!e164) {
      setError("Please enter a valid phone number");
      return;
    }
    setLoading(true);
    try {
      await auth.signInWithPhone(e164);
      setStage({ kind: "otp", phone: e164 });
      setOtpCode("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith(PHONE_CONFLICT_PREFIX)) {
        setPhoneConflictOpen(true);
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp() {
    if (stage.kind !== "otp") return;
    setError(null);
    setLoading(true);
    try {
      await auth.verifyOtp(stage.phone, otpCode.trim());
      // onAuthStateChange will flip auth.session, and the guard at the
      // top of render will push us to the name stage if profile is
      // still null (i.e. first-time customer). If profile already
      // exists (returning customer), close the dialog.
      if (auth.profile) onComplete?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith(PHONE_CONFLICT_PREFIX)) {
        setPhoneConflictOpen(true);
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleCompleteSignup() {
    setError(null);
    if (!firstName.trim()) {
      setError("First name is required");
      return;
    }
    setLoading(true);
    try {
      await auth.completeSignup({
        firstName: firstName.trim(),
        lastName: lastName.trim() || undefined,
      });
      onComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-black/10 bg-white p-5 shadow-sm sm:p-8">
      <h2 className="mb-1.5 text-2xl font-bold text-zinc-900">{heading}</h2>
      <p className="mb-6 text-sm leading-relaxed text-zinc-600">{subheading}</p>

      {stage.kind === "chooser" && (
        <div className="space-y-3">
          {showApple && (
            <button
              type="button"
              onClick={handleApple}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-black py-3.5 text-sm font-semibold text-white transition hover:bg-black/85"
            >
              <AppleLogo />
              <span>Continue with Apple</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleGoogle}
            className="flex w-full items-center justify-center gap-2 rounded-full border border-black/15 bg-white py-3.5 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50"
          >
            <GoogleLogo />
            <span>Continue with Google</span>
          </button>

          <div className="my-4 flex items-center gap-3 text-xs text-zinc-400">
            <div className="h-px flex-1 bg-black/10" />
            <span>or</span>
            <div className="h-px flex-1 bg-black/10" />
          </div>

          <button
            type="button"
            onClick={() => setStage({ kind: "phone" })}
            className="w-full rounded-full border border-black/15 py-3.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
          >
            Use phone number instead
          </button>
        </div>
      )}

      {stage.kind === "phone" && (
        <div className="space-y-5">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-zinc-800">
              Mobile Number
            </span>
            <div className="flex items-center gap-2">
              <span
                className="flex shrink-0 items-center justify-center rounded-full px-4 py-2.5 text-sm font-medium"
                style={{
                  backgroundColor: BRAND.accentColor,
                  color: BRAND.primaryColor,
                }}
              >
                +61
              </span>
              <input
                type="tel"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                placeholder="400 000 000"
                autoComplete="tel"
                autoFocus
                className="w-full rounded-full border border-black/15 bg-white px-4 py-2.5 text-sm outline-none focus:border-black/40"
              />
            </div>
          </label>
          <button
            type="button"
            onClick={handleSendOtp}
            disabled={loading}
            className="mt-2 w-full rounded-full py-3.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: BRAND.primaryColor }}
          >
            {loading ? "Sending code..." : "Send verification code"}
          </button>
          <button
            type="button"
            onClick={handleBackToChooser}
            className="block pt-1 text-xs text-zinc-500 underline-offset-2 hover:underline"
          >
            ← Back
          </button>
        </div>
      )}

      {stage.kind === "otp" && (
        <div className="space-y-5">
          <p className="text-sm text-zinc-600">
            Sent to <span className="font-medium text-zinc-800">{stage.phone}</span>
          </p>
          <OtpInput value={otpCode} onChange={setOtpCode} disabled={loading} />
          <button
            type="button"
            onClick={handleVerifyOtp}
            disabled={loading || otpCode.replace(/\s/g, "").length < 6}
            className="mt-2 w-full rounded-full py-3.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: BRAND.primaryColor }}
          >
            {loading ? "Verifying..." : "Verify →"}
          </button>
          <button
            type="button"
            onClick={() => setStage({ kind: "phone" })}
            className="block pt-1 text-xs text-zinc-500 underline-offset-2 hover:underline"
          >
            ← Use a different number
          </button>
        </div>
      )}

      {stage.kind === "name" && extractNameFromMetadata(auth.user) && (
        <div className="flex items-center justify-center gap-3 py-6 text-sm text-zinc-600">
          <span
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700"
            aria-hidden
          />
          Setting up your account…
        </div>
      )}

      {stage.kind === "name" && !extractNameFromMetadata(auth.user) && (
        <div className="space-y-5">
          <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
            ✓ Signed in. What should we call you?
          </div>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-zinc-800">
              First Name
            </span>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              autoComplete="given-name"
              autoFocus
              className="w-full rounded-full border border-black/15 bg-white px-4 py-2.5 text-sm outline-none focus:border-black/40"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-zinc-800">
              Last Name
            </span>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              autoComplete="family-name"
              className="w-full rounded-full border border-black/15 bg-white px-4 py-2.5 text-sm outline-none focus:border-black/40"
            />
          </label>
          <button
            type="button"
            onClick={handleCompleteSignup}
            disabled={loading}
            className="mt-2 w-full rounded-full py-3.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: BRAND.primaryColor }}
          >
            {loading ? "Creating account..." : "Create Account →"}
          </button>
          {!auth.user?.phone && (
            <p className="text-xs text-zinc-500">
              You&apos;ll need to verify a phone number to place orders and
              earn loyalty stars.
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <PhoneConflictDialog
        open={phoneConflictOpen}
        onClose={() => setPhoneConflictOpen(false)}
      />
    </div>
  );
}

function AppleLogo() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="20"
      viewBox="0 0 814 1000"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57.8-155.5-127.4c-58.8-82-106.4-209.5-106.4-330.8 0-194.3 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 103.5-30.4 135.5-71.3z" />
    </svg>
  );
}

function GoogleLogo() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 48 48"
      aria-hidden="true"
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#34A853"
        d="M10.53 28.59A14.5 14.5 0 0 1 9.5 24c0-1.59.28-3.14.76-4.59l-7.98-6.19A23.99 23.99 0 0 0 0 24c0 3.77.9 7.35 2.56 10.53l7.97-5.94z"
      />
      <path
        fill="#FBBC05"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 5.94C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
