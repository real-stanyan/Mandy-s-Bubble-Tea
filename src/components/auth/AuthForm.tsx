"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import type { User } from "@supabase/supabase-js";
import {
  User as UserIcon,
  Phone as PhoneIcon,
  Receipt,
  ArrowRight,
  ArrowLeft,
  Loader2,
} from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { PhoneConflictDialog } from "@/components/auth/PhoneConflictDialog";
import {
  normalizePhone,
  isPhoneValid,
  prettyPhone,
  splitFullName,
  normalizeEmail,
} from "@/lib/auth-format";

const PHONE_CONFLICT_PREFIX = "This phone number is already linked";
const OTP_LENGTH = 6; // Supabase phone OTP is 6 digits (design shows 4 — prototype simplification).

type Mode = "join" | "signin";
type Step = "form" | "otp" | "name";

// --- Apple native-sheet detection (kept from the prior SignInCard) -------
function isAppleNativeSignInDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  const platform = (navigator as unknown as { platform?: string }).platform;
  const isMac = platform === "MacIntel" || /Macintosh/.test(ua);
  if (!isMac) return false;
  if (navigator.maxTouchPoints > 1) return true;
  return (
    /Safari/.test(ua) &&
    !/Chrome|Chromium|CriOS|FxiOS|Firefox|Edg\/|OPR\//.test(ua)
  );
}

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
  if (full) return splitFullName(full);
  return null;
}

export type AuthFormProps = {
  onComplete?: () => void;
  /** "card" = full-bleed mobile/compact (hero + perks). "panel" = desktop split-card right side (eyebrow, no hero/perks). */
  variant?: "card" | "panel";
  /** Override the mode-derived headline (e.g. checkout: "Sign in to check out"). */
  headingOverride?: string;
  subheadingOverride?: string;
};

export function AuthForm({
  onComplete,
  variant = "card",
  headingOverride,
  subheadingOverride,
}: AuthFormProps) {
  const auth = useAuth();
  const [mode, setMode] = useState<Mode>("join");
  const [step, setStep] = useState<Step>("form");
  const [fullName, setFullName] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resentAt, setResentAt] = useState<number | null>(null);
  const [showApple, setShowApple] = useState(false);
  const [phoneConflictOpen, setPhoneConflictOpen] = useState(false);

  const scopeRef = useRef<HTMLDivElement>(null);
  const codeRefs = useRef<(HTMLInputElement | null)[]>([]);
  const autoSignupRef = useRef(false);
  // Name/email collected up-front in join mode, applied after OTP verify.
  const pendingSignup = useRef<{
    firstName: string;
    lastName?: string;
    email: string | null;
  } | null>(null);

  useEffect(() => {
    setShowApple(isAppleNativeSignInDevice());
  }, []);

  // OAuth (Apple/Google) returns a session with no phone + no profile.
  // Route those through phone-link → name. Phone sign-ins arrive here
  // already with a phone.
  const oauthLinking = !!auth.session && !auth.profile && !auth.user?.phone;
  if (auth.session && !auth.profile) {
    if (!auth.user?.phone && step !== "form" && step !== "otp") {
      setStep("form");
    } else if (auth.user?.phone && step !== "name") {
      setStep("name");
    }
  } else if (!auth.session && step === "name" && !pendingSignup.current) {
    // Session dropped while on the name step (server self-heal) — bail to form.
    setStep("form");
  }

  // Auto-complete signup once we land on the name step with either a
  // pending typed name (phone-join) or OAuth metadata. Runs in an effect
  // so the Supabase session cookie has settled before the server call.
  useEffect(() => {
    if (step !== "name") return;
    if (auth.profile) return;
    if (autoSignupRef.current) return;
    const fromPending = pendingSignup.current;
    const fromMeta = extractNameFromMetadata(auth.user);
    const payload = fromPending ?? fromMeta;
    if (!payload) return; // manual name form will handle it
    if (!auth.user?.phone) return; // wait for phone to attach
    autoSignupRef.current = true;
    setLoading(true);
    setError(null);
    auth
      .completeSignup({
        firstName: payload.firstName,
        lastName: payload.lastName,
        email: fromPending?.email ?? undefined,
      })
      .then(() => {
        pendingSignup.current = null;
        onComplete?.();
      })
      .catch((err) => {
        autoSignupRef.current = false;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, [step, auth, onComplete]);

  const phoneValid = isPhoneValid(phoneInput);
  const nameValid = fullName.trim().length > 1;
  const formValid = oauthLinking
    ? phoneValid
    : mode === "join"
      ? nameValid && phoneValid
      : phoneValid;
  const codeComplete = code.every((c) => c !== "");

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

  async function handleSubmitForm() {
    setError(null);
    const e164 = normalizePhone(phoneInput.trim());
    if (!e164) {
      setError("Please enter a valid phone number");
      return;
    }
    // Stash name/email for after verification (skip for OAuth-link / signin).
    if (!oauthLinking && mode === "join") {
      const { firstName, lastName } = splitFullName(fullName);
      pendingSignup.current = {
        firstName,
        lastName,
        email: normalizeEmail(email),
      };
    } else {
      pendingSignup.current = null;
    }
    setSending(true);
    try {
      await auth.signInWithPhone(e164);
      setCode(Array(OTP_LENGTH).fill(""));
      setStep("otp");
      window.setTimeout(() => codeRefs.current[0]?.focus(), 350);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith(PHONE_CONFLICT_PREFIX)) setPhoneConflictOpen(true);
      else setError(message);
    } finally {
      setSending(false);
    }
  }

  async function handleVerify() {
    setError(null);
    const e164 = normalizePhone(phoneInput.trim());
    if (!e164) return;
    setLoading(true);
    try {
      await auth.verifyOtp(e164, code.join(""));
      // Returning customer already has a profile → done. Otherwise the
      // render guard pushes us to the name step, where the effect above
      // finishes signup (pending name or OAuth metadata) or shows the
      // manual name form.
      if (auth.profile) onComplete?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith(PHONE_CONFLICT_PREFIX)) setPhoneConflictOpen(true);
      else setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    const e164 = normalizePhone(phoneInput.trim());
    if (!e164) return;
    try {
      await auth.signInWithPhone(e164);
      setResentAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleBackToForm() {
    setError(null);
    setCode(Array(OTP_LENGTH).fill(""));
    // OAuth back must drop the session, else the render guard re-forwards.
    if (auth.session && oauthLinking) {
      try {
        await auth.signOut();
      } catch {
        /* still want to show the form */
      }
    }
    setStep("form");
  }

  function setCodeAt(i: number, raw: string) {
    const v = raw.replace(/\D/g, "").slice(-1);
    setCode((prev) => {
      const next = [...prev];
      next[i] = v;
      return next;
    });
    if (v && i < OTP_LENGTH - 1) codeRefs.current[i + 1]?.focus();
  }
  function onCodeKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !code[i] && i > 0) {
      codeRefs.current[i - 1]?.focus();
    }
  }

  // Entrance animation — re-runs on step/mode change. Reduced-motion safe.
  useGSAP(
    () => {
      const els = scopeRef.current?.querySelectorAll(".au");
      if (!els || !els.length) return;
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        // fromTo (not from): the visible end state is hard-coded, so a re-run
        // that fires mid-stagger can never capture a half-faded 0 as the target
        // and strand an element (usually the last button) at opacity:0.
        // overwrite kills any in-flight tween on the same targets; clearProps
        // removes the inline opacity/transform once shown.
        gsap.fromTo(
          els,
          { opacity: 0, y: 16 },
          {
            opacity: 1,
            y: 0,
            duration: 0.5,
            ease: "power3.out",
            stagger: 0.05,
            overwrite: "auto",
            clearProps: "opacity,transform",
          },
        );
      });
      return () => mm.revert();
    },
    { scope: scopeRef, dependencies: [step, mode, oauthLinking] },
  );

  const heading =
    headingOverride ??
    (oauthLinking
      ? "One more step"
      : mode === "join"
        ? variant === "panel"
          ? "Create your account"
          : "Join Mandy's Rewards"
        : "Welcome back");
  const subheading =
    subheadingOverride ??
    (oauthLinking
      ? "Add your mobile number to finish signing in."
      : mode === "join"
        ? "Earn a star with every drink — nine stars and your next one's on us."
        : "Sign in to track orders, scan in-store and spend your stars.");

  return (
    <div ref={scopeRef}>
      {step === "form" && (
        <div>
          {variant === "card" && !oauthLinking && (
            <div className="au mb-5 flex flex-col items-center text-center">
              <BrandHero />
            </div>
          )}
          {variant === "panel" && (
            <p className="au mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.13em] text-brand">
              Mandy&apos;s Rewards
            </p>
          )}
          <h2
            className={`au font-serif font-semibold tracking-[-0.02em] text-ink ${
              variant === "panel"
                ? "text-[30px] leading-tight"
                : "text-center text-[28px] leading-[1.1]"
            }`}
          >
            {heading}
          </h2>
          <p
            className={`au mt-2 text-[13.5px] leading-relaxed text-ink2 ${
              variant === "panel" ? "" : "mx-auto max-w-[280px] text-center"
            }`}
          >
            {subheading}
          </p>

          {!oauthLinking && (
            <>
              <ModeToggle mode={mode} onChange={setMode} />
              <div className="au mt-[18px] flex gap-2.5">
                {showApple && (
                  <SocialButton kind="apple" onClick={handleApple} />
                )}
                <SocialButton kind="google" onClick={handleGoogle} />
              </div>
              <Divider />
            </>
          )}

          <div className="flex flex-col gap-3.5">
            {!oauthLinking && mode === "join" && (
              <AuthField
                className="au"
                label="Full name"
                icon={<UserIcon size={17} />}
                value={fullName}
                onChange={setFullName}
                placeholder="e.g. Mandy Zhang"
                autoComplete="name"
              />
            )}
            <AuthField
              className="au"
              label="Mobile number"
              icon={<PhoneIcon size={17} />}
              prefix="+61"
              value={phoneInput}
              onChange={setPhoneInput}
              placeholder="0404 978 238"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
            />
            {!oauthLinking && mode === "join" && (
              <AuthField
                className="au"
                label="Email (for receipts)"
                icon={<Receipt size={17} />}
                value={email}
                onChange={setEmail}
                placeholder="you@email.com"
                type="email"
                inputMode="email"
                autoComplete="email"
              />
            )}
          </div>

          <button
            type="button"
            onClick={handleSubmitForm}
            disabled={!formValid || sending}
            className="au mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-brand px-5 py-[15px] text-sm font-semibold text-white shadow-[0_12px_22px_rgba(141,85,36,0.30)] transition active:scale-[0.97] hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
          >
            {sending ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <>
                {oauthLinking
                  ? "Send me a code"
                  : mode === "join"
                    ? "Create account"
                    : "Send me a code"}
                <ArrowRight size={16} />
              </>
            )}
          </button>

          {variant === "card" && !oauthLinking && mode === "join" && (
            <PerksCard className="au" />
          )}

          <LegalFooter className="au" centered={variant === "card"} />
        </div>
      )}

      {step === "otp" && (
        <div>
          <button
            type="button"
            onClick={handleBackToForm}
            className="au mb-[18px] flex items-center gap-1.5 text-[13.5px] font-semibold text-ink2 transition hover:text-ink"
          >
            <ArrowLeft size={16} /> Back
          </button>
          <div className="au flex h-[60px] w-[60px] items-center justify-center rounded-[18px] bg-cream text-brand">
            <PhoneIcon size={26} />
          </div>
          <h2 className="au mt-4 font-serif text-[27px] font-semibold tracking-[-0.018em] text-ink">
            Enter your code
          </h2>
          <p className="au mt-2 text-[13.5px] text-ink2">
            We texted a {OTP_LENGTH}-digit code to{" "}
            <span className="whitespace-nowrap font-semibold text-ink">
              {prettyPhone(phoneInput)}
            </span>
            .
          </p>

          <div className="au mt-[26px] flex gap-2.5">
            {code.map((c, i) => (
              <input
                key={i}
                ref={(el) => {
                  codeRefs.current[i] = el;
                }}
                value={c}
                onChange={(e) => setCodeAt(i, e.target.value)}
                onKeyDown={(e) => onCodeKeyDown(i, e)}
                inputMode="numeric"
                maxLength={1}
                aria-label={`Digit ${i + 1}`}
                className={`h-16 w-full min-w-0 rounded-[15px] border-[1.5px] text-center font-mono text-[28px] font-bold text-ink outline-none transition-all ${
                  c
                    ? "border-brand bg-cream"
                    : "border-line bg-paper"
                }`}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={handleVerify}
            disabled={!codeComplete || loading}
            className="au mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-brand px-5 py-[15px] text-sm font-semibold text-white shadow-[0_12px_22px_rgba(141,85,36,0.30)] transition active:scale-[0.97] hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
          >
            {loading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              "Verify & continue"
            )}
          </button>

          <div className="au mt-[18px] text-center">
            {resentAt ? (
              <span className="text-[12.5px] font-semibold text-green-dark">
                ✓ New code sent
              </span>
            ) : (
              <button
                type="button"
                onClick={handleResend}
                className="text-[13px] font-semibold text-brand transition hover:text-brand-dark"
              >
                Didn&apos;t get it? Resend code
              </button>
            )}
          </div>
        </div>
      )}

      {step === "name" && <NameStep
        auth={auth}
        loading={loading}
        setLoading={setLoading}
        error={error}
        setError={setError}
        onComplete={onComplete}
      />}

      {error && step !== "name" && (
        <p className="mt-4 rounded-tile border border-red-200 bg-red-50 p-3 text-sm text-red-700">
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

// ---- Name step (OAuth users w/o shared name, or incomplete phone users) --
function NameStep({
  auth,
  loading,
  setLoading,
  error,
  setError,
  onComplete,
}: {
  auth: ReturnType<typeof useAuth>;
  loading: boolean;
  setLoading: (b: boolean) => void;
  error: string | null;
  setError: (s: string | null) => void;
  onComplete?: () => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const autoFromMeta = !!extractNameFromMetadata(auth.user);

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

  if (autoFromMeta || loading) {
    return (
      <div className="flex items-center justify-center gap-3 py-8 text-sm text-ink2">
        <Loader2 size={18} className="animate-spin" />
        Setting up your account…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="rounded-tile border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-dark">
        ✓ Signed in. What should we call you?
      </div>
      <AuthField
        label="First name"
        icon={<UserIcon size={17} />}
        value={firstName}
        onChange={setFirstName}
        placeholder="e.g. Mandy"
        autoComplete="given-name"
      />
      <AuthField
        label="Last name"
        icon={<UserIcon size={17} />}
        value={lastName}
        onChange={setLastName}
        placeholder="Zhang"
        autoComplete="family-name"
      />
      <button
        type="button"
        onClick={handleCompleteSignup}
        disabled={loading}
        className="mt-1 flex w-full items-center justify-center gap-2 rounded-full bg-brand px-5 py-[15px] text-sm font-semibold text-white shadow-[0_12px_22px_rgba(141,85,36,0.30)] transition active:scale-[0.97] hover:bg-brand-dark disabled:opacity-50"
      >
        Create account <ArrowRight size={16} />
      </button>
      {error && (
        <p className="rounded-tile border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

// ---- Small presentational pieces ----------------------------------------

function BrandHero() {
  return (
    <div
      className="flex h-[70px] w-[70px] rotate-[-4deg] items-center justify-center rounded-[22px] border border-line shadow-[0_10px_24px_rgba(141,85,36,0.18)]"
      style={{ background: "linear-gradient(160deg,#FFF9F0,#FFE9CE)" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.webp"
        alt="Mandy's Bubble Tea"
        width={52}
        height={52}
        className="h-[52px] w-[52px] object-contain"
      />
    </div>
  );
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
}) {
  return (
    <div className="au mt-[22px] flex rounded-full bg-bg2 p-1">
      {(
        [
          ["join", "Create account"],
          ["signin", "Sign in"],
        ] as const
      ).map(([value, label]) => {
        const active = mode === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onChange(value)}
            className={`flex-1 rounded-full px-3 py-2.5 text-[13.5px] font-bold transition ${
              active
                ? "bg-card text-brand shadow-[0_2px_6px_rgba(42,30,20,0.12)]"
                : "text-ink3"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function Divider() {
  return (
    <div className="au my-[18px] flex items-center gap-3">
      <span className="h-px flex-1 bg-line" />
      <span className="text-[11.5px] font-semibold uppercase tracking-wide text-ink4">
        or with your phone
      </span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

function SocialButton({
  kind,
  onClick,
}: {
  kind: "apple" | "google";
  onClick: () => void;
}) {
  if (kind === "apple") {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex flex-1 items-center justify-center gap-2.5 rounded-[13px] bg-black px-3 py-3 text-[13.5px] font-semibold text-white transition active:scale-[0.98]"
      >
        <AppleGlyph /> Apple
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-1 items-center justify-center gap-2.5 rounded-[13px] border-[1.5px] border-line bg-card px-3 py-3 text-[13.5px] font-semibold text-ink transition hover:bg-paper active:scale-[0.98]"
    >
      <GoogleGlyph /> Google
    </button>
  );
}

function PerksCard({ className = "" }: { className?: string }) {
  const perks: [ReactNode, string, string][] = [
    [<StarGlyph key="s" />, "A star for every drink", "In-store or online — they add up fast."],
    [<GiftGlyph key="g" />, "Free drink at nine stars", "Your loyalty card, always in your pocket."],
    [<FlaskGlyph key="f" />, "Member-only sips", "First dibs on seasonal specials."],
  ];
  return (
    <div
      className={`${className} mt-[18px] flex flex-col gap-[11px] rounded-card bg-cream p-[15px]`}
      style={{ border: "1px solid rgba(141,85,36,0.14)" }}
    >
      {perks.map(([icon, title, desc]) => (
        <div key={title} className="flex items-start gap-3">
          <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-card text-brand">
            {icon}
          </span>
          <div>
            <p className="text-[13px] font-bold text-ink">{title}</p>
            <p className="text-[11.5px] text-ink3">{desc}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function LegalFooter({
  className = "",
  centered,
}: {
  className?: string;
  centered: boolean;
}) {
  return (
    <p
      className={`${className} mt-4 text-[10.5px] leading-relaxed text-ink4 ${
        centered ? "mx-auto max-w-[270px] text-center" : ""
      }`}
    >
      By continuing you agree to Mandy&apos;s{" "}
      <span className="font-semibold text-ink3">Terms</span> &{" "}
      <span className="font-semibold text-ink3">Privacy Policy</span>.
    </p>
  );
}

// ---- AuthField ----------------------------------------------------------
function AuthField({
  label,
  icon,
  prefix,
  value,
  onChange,
  placeholder,
  type = "text",
  inputMode,
  autoComplete,
  className = "",
}: {
  label: string;
  icon: ReactNode;
  prefix?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  inputMode?: "tel" | "email" | "numeric" | "text";
  autoComplete?: string;
  className?: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <label className={`${className} block`}>
      <span className="mb-[7px] block text-xs font-semibold text-ink2">
        {label}
      </span>
      <div
        className="flex items-center gap-2 rounded-[13px] bg-paper px-3.5 transition-all"
        style={{
          border: `1.5px solid ${focused ? "var(--color-brand)" : "var(--color-line)"}`,
          boxShadow: focused ? "0 0 0 4px rgba(141,85,36,0.10)" : "none",
        }}
      >
        <span className={focused ? "text-brand" : "text-ink4"}>{icon}</span>
        {prefix && (
          <span className="font-mono text-sm text-ink2">{prefix}</span>
        )}
        <input
          type={type}
          inputMode={inputMode}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          className="w-full bg-transparent py-[13px] text-[15px] text-ink outline-none placeholder:text-ink4"
        />
      </div>
    </label>
  );
}

// ---- Brand glyphs (icons styled to match the prototype) -----------------
function AppleGlyph() {
  return (
    <svg width="15" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.564 12.69c-.02-2.28 1.86-3.37 1.94-3.42-1.06-1.55-2.71-1.76-3.3-1.78-1.39-.14-2.73.82-3.44.82-.72 0-1.81-.81-2.97-.79-1.52.02-2.94.89-3.72 2.25-1.6 2.77-.41 6.85 1.13 9.1.77 1.1 1.68 2.34 2.87 2.29 1.16-.05 1.59-.74 2.99-.74s1.79.74 3.01.72c1.25-.02 2.03-1.11 2.78-2.22.88-1.27 1.24-2.51 1.25-2.58-.03-.01-2.39-.92-2.41-3.64zM15.21 5.9c.64-.78 1.07-1.86.95-2.93-.92.04-2.04.61-2.7 1.38-.59.69-1.11 1.79-.97 2.85 1.03.08 2.08-.52 2.72-1.3z" />
    </svg>
  );
}
function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#34A853" d="M10.53 28.59A14.5 14.5 0 0 1 9.5 24c0-1.59.28-3.14.76-4.59l-7.98-6.19A23.99 23.99 0 0 0 0 24c0 3.77.9 7.35 2.56 10.53l7.97-5.94z" />
      <path fill="#FBBC05" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 5.94C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
function StarGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2l2.9 6.26L21.5 9l-4.75 4.5L17.9 21 12 17.27 6.1 21l1.15-7.5L2.5 9l6.6-.74L12 2z" />
    </svg>
  );
}
function GiftGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="8" width="18" height="4" rx="1" /><path d="M12 8v13M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /><path d="M12 8C12 8 10.5 3 7.5 4.5 5.5 5.5 7 8 12 8zM12 8c0 0 1.5-5 4.5-3.5C18.5 5.5 17 8 12 8z" />
    </svg>
  );
}
function FlaskGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 3h6M10 3v6.5L5 18a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-8.5V3" /><path d="M7.5 14h9" />
    </svg>
  );
}
