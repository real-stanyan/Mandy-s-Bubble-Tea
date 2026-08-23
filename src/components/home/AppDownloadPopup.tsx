"use client";

import { useEffect, useRef, useState } from "react";
import { BRAND } from "@/lib/constants";
import { isPhoneValid } from "@/lib/auth-format";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAppDownloadPopupEligibility } from "@/hooks/use-app-download-popup-eligibility";

// Campaign popup: "Download the app, get 20% off your first order." Collects a
// phone number and POSTs to the app-download claim route — the grant is minted
// against that phone, and resolves automatically when the visitor later signs
// into the app with the same number (no install attribution; see
// mandys_bubble_tea docs/adr/0002). Shown once per visitor (localStorage), so
// returning visitors fall back to the loyalty popup.
//
// Signed-in visitors get it too: having a website account says nothing about
// whether you have the app, and the campaign is about the app. The only people
// it skips are those who already hold or already spent a grant — re-offering
// "20% off your first order" to them is noise. That check is only possible
// when signed in (the grant resolves from the session's phone), so signed-out
// visitors always see it once.

const APP_STORE_URL =
  "https://apps.apple.com/au/app/mandys-bubble-tea/id6762111842";
const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.mandysbubbletea.app";

const REVEAL_DELAY_MS = 900;

// Which store the download button points at. UA sniffing is exactly the right
// tool here: it only picks the DEFAULT button, and the other store stays one
// tap away underneath, so a wrong guess costs nothing. Read in an effect (the
// popup reveals well after hydration, so the flip is never visible).
function useIsAndroid(): boolean {
  const [isAndroid, setIsAndroid] = useState(false);
  useEffect(() => {
    setIsAndroid(/android/i.test(navigator.userAgent));
  }, []);
  return isAndroid;
}

function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    const onChange = () => setReduce(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduce;
}

// "done" = the grant was minted by this submit. "already" / "used" = the phone
// was already on file — unspent, or spent on a past order. Kept apart because
// telling someone who already drank their 20% off that it's "waiting" is a lie
// they'd only discover at checkout.
type ClaimState = "form" | "submitting" | "done" | "already" | "used";

export function AppDownloadPopup() {
  const { profile } = useAuth();
  const eligibility = useAppDownloadPopupEligibility();
  const isAndroid = useIsAndroid();
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [phone, setPhone] = useState("");
  const [state, setState] = useState<ClaimState>("form");
  const [error, setError] = useState<string | null>(null);
  const reduce = usePrefersReducedMotion();
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Prefill the number we already know, so a signed-in visitor doesn't type a
  // different one by hand and mint the grant against a phone they'll never
  // sign into the app with. `profile.phone_e164` is E.164; the field renders
  // its own +61 prefix, so hand it the national part.
  useEffect(() => {
    const e164 = profile?.phone_e164;
    if (!e164) return;
    setPhone((current) => (current ? current : `0${e164.replace(/^\+61/, "")}`));
  }, [profile]);

  // Reveal after a short delay so it doesn't slam the page on first paint.
  // "pending" waits rather than showing and retracting.
  useEffect(() => {
    if (eligibility !== "eligible") return;
    revealTimer.current = setTimeout(() => setVisible(true), REVEAL_DELAY_MS);
    return () => {
      if (revealTimer.current) clearTimeout(revealTimer.current);
    };
  }, [eligibility]);

  // Entrance: flip `mounted` a frame after the node is in the tree so the
  // opacity/scale transition actually runs.
  useEffect(() => {
    if (!visible) {
      setMounted(false);
      return;
    }
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, [visible]);

  if (!visible) return null;

  // Closing hides it for this page view only — nothing is persisted. The popup
  // is meant to come back on the next visit; see the eligibility hook.
  function dismiss() {
    setVisible(false);
  }

  async function submit() {
    if (!isPhoneValid(phone) || state === "submitting") return;
    setState("submitting");
    setError(null);
    try {
      const res = await fetch("/api/promotions/app-download/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ phone }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        setError(
          json?.error === "invalid phone"
            ? "That doesn't look like a valid mobile number."
            : "Something went wrong. Please try again.",
        );
        setState("form");
        return;
      }
      // { ok: true, alreadyClaimed, redeemed } — three outcomes, three
      // messages. A number already on file isn't an error: the grant is
      // per-phone and idempotent, so re-entering it changed nothing.
      setState(
        !json.alreadyClaimed ? "done" : json.redeemed ? "used" : "already",
      );
    } catch {
      setError("Something went wrong. Please try again.");
      setState("form");
    }
  }

  const canSubmit = isPhoneValid(phone) && state !== "submitting";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      style={{
        opacity: mounted ? 1 : 0,
        transition: "opacity 200ms ease-out",
      }}
      onClick={dismiss}
    >
      <div
        className="relative w-full max-w-sm overflow-hidden rounded-3xl shadow-2xl"
        style={{
          backgroundColor: "#FFFDF8",
          opacity: mounted ? 1 : 0,
          transform: reduce ? undefined : `scale(${mounted ? 1 : 0.96})`,
          transition: reduce
            ? "opacity 200ms ease-out"
            : "opacity 220ms cubic-bezier(0.23, 1, 0.32, 1), transform 220ms cubic-bezier(0.23, 1, 0.32, 1)",
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Download the app for 20% off"
      >
        <button
          onClick={dismiss}
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/10 text-[#5A4330] transition hover:bg-black/20 active:scale-95"
          aria-label="Close"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        {/* Offer hero */}
        <div className="px-6 pb-5 pt-7" style={{ backgroundImage: "linear-gradient(120deg, #FFB380 0%, #FFCFA3 52%, #FFF3DE 100%)" }}>
          <span className="inline-block rounded bg-[#2A1E14] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-[#FFF3DE] sm:text-[10px]">
            App exclusive
          </span>
          <h2 className="mt-3 font-serif text-[30px] leading-[1.02] tracking-tight text-[#2A1E14]">
            20% off
            <br />
            <span className="italic">your first order</span>
          </h2>
          <p className="mt-2 max-w-[30ch] text-[13px] leading-snug text-[#5A4330]">
            Drop your number, download the app, and your discount is waiting the
            moment you sign in.
          </p>
        </div>

        {state === "done" || state === "already" || state === "used" ? (
          /* ── Outcome: newly claimed / already on file / already spent ── */
          <div className="px-6 pb-6 pt-5">
            <div className="flex items-center gap-2">
              <span className="text-[22px]">
                {state === "used" ? "☕" : state === "already" ? "✅" : "🎉"}
              </span>
              <h3 className="font-serif text-[20px] leading-tight text-[#2A1E14]">
                {state === "used"
                  ? "You've already used this one"
                  : state === "already"
                    ? "This number's already claimed"
                    : "You're locked in"}
              </h3>
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-[#6B5440]">
              {state === "used" ? (
                <>
                  Your 20% off has already been applied to an order — it&apos;s
                  one per number. Keep the app though: rewards, order tracking
                  and a free drink every 9 cups.
                </>
              ) : state === "already" ? (
                <>
                  Good news — it&apos;s still unused. Download the app and sign
                  in with this number, and your 20% off comes off automatically
                  at checkout.
                </>
              ) : (
                <>
                  Download the app and sign in with this number — your 20% off
                  will be applied automatically at checkout.
                </>
              )}
            </p>
            <a
              href={isAndroid ? PLAY_STORE_URL : APP_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={dismiss}
              className="mt-5 inline-flex w-full items-center justify-center gap-1.5 rounded-full px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90 active:scale-[0.98]"
              style={{ backgroundColor: BRAND.primaryColor, transitionProperty: "opacity, transform" }}
            >
              {isAndroid ? "Get it on Google Play →" : "Download on the App Store →"}
            </a>
            <a
              href={isAndroid ? APP_STORE_URL : PLAY_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={dismiss}
              className="mt-2.5 block text-center text-[12px] font-medium text-[#9A876F] underline underline-offset-2 transition hover:text-[#6B5440]"
            >
              {isAndroid ? "Also on the App Store" : "Also on Google Play"}
            </a>
          </div>
        ) : (
          /* ── Claim form ── */
          <div className="px-6 pb-6 pt-5">
            <label htmlFor="app-dl-phone" className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#6B5440]">
              Mobile number
            </label>
            <div
              className="mt-2 flex items-center gap-2 rounded-2xl border bg-white px-3.5 py-3 transition"
              style={{ borderColor: error ? "#DC2626" : "#E8DBC8" }}
            >
              <span className="select-none text-[15px] font-medium text-[#9A876F]">+61</span>
              <input
                id="app-dl-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="0404 978 238"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
                className="w-full bg-transparent text-[15px] text-[#2A1E14] outline-none placeholder:text-[#B3A28D]"
              />
            </div>
            {error && (
              <p role="alert" className="mt-2 text-[12px] font-medium text-red-600">
                {error}
              </p>
            )}

            <button
              onClick={submit}
              disabled={!canSubmit}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90 active:scale-[0.98] disabled:opacity-40"
              style={{ backgroundColor: BRAND.primaryColor, transitionProperty: "opacity, transform" }}
            >
              {state === "submitting" && (
                <svg className="animate-spin" width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity="0.3" />
                  <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              )}
              {state === "submitting" ? "Claiming…" : "Claim my 20%"}
            </button>
            <p className="mt-2.5 text-center text-[11px] leading-snug text-[#9A876F]">
              One order, one number. No spam — just your discount.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
