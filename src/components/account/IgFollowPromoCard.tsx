"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { BRAND } from "@/lib/constants";

const IG_URL = "https://instagram.com/mandysbubbletea";
const VISITED_KEY = "mbt.igFollowVisited";

// Inline SVG (lucide-react 1.x dropped brand icons; this is the standard
// 24x24 stroke=2 Instagram glyph from the Simple Icons set).
function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}

export function IgFollowPromoCard() {
  const { profile, igFollowDiscount, claimIgFollowDiscount } = useAuth();
  const [visited, setVisited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  // `redeemedAt` lives only on the dedicated status endpoint — context
  // exposes available/percentage/drinksRemaining but not redeemedAt
  // (kept narrow on hydration to avoid bloating /api/me). We fetch it
  // here so the card is self-contained and any caller (e.g. /account
  // page or /account/promotions) gets the full Locked / Active /
  // Redeemed state without extra wiring.
  const [redeemedAt, setRedeemedAt] = useState<string | null>(null);

  useEffect(() => {
    setVisited(
      typeof window !== "undefined" &&
        window.localStorage.getItem(VISITED_KEY) === "1",
    );
  }, []);

  // Fetch redeemedAt only for signed-in users; guests can never be in
  // the Redeemed state. Refetch when igFollowDiscount.available flips
  // from true → false (i.e. just consumed) so the card transitions
  // Locked/Active → Redeemed without a manual reload.
  useEffect(() => {
    if (!profile) {
      setRedeemedAt(null);
      return;
    }
    let alive = true;
    fetch("/api/promotions/ig-follow/status", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (!alive) return;
        setRedeemedAt(data?.redeemedAt ?? null);
      })
      .catch(() => {
        if (!alive) return;
        setRedeemedAt(null);
      });
    return () => {
      alive = false;
    };
  }, [profile, igFollowDiscount.available]);

  const handleStep1 = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(VISITED_KEY, "1");
    }
    setVisited(true);
  };

  const handleClaim = async () => {
    setBusy(true);
    setErrMsg(null);
    try {
      await claimIgFollowDiscount();
    } catch (err) {
      setErrMsg("Couldn't claim right now. Please try again.");
      console.error(err);
    } finally {
      setBusy(false);
    }
  };

  // ----- Redeemed state: ticket fully consumed -----
  if (redeemedAt && !igFollowDiscount.available) {
    return (
      <div className="px-4 mt-3">
        <article className="rounded-card border border-black/5 bg-zinc-50 p-[22px] shadow-mini-cart">
          <div className="flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-zinc-400" />
            <span
              className="font-mono uppercase text-zinc-400"
              style={{
                fontSize: 10.5,
                letterSpacing: 1.3,
                fontWeight: 700,
              }}
            >
              IG FOLLOW PROMO · USED
            </span>
          </div>
          <h3
            className="mt-2 font-serif text-zinc-400 line-through"
            style={{
              fontSize: 28,
              lineHeight: "32px",
              letterSpacing: -0.6,
              fontWeight: 500,
            }}
          >
            10% off
          </h3>
          <p
            className="mt-2 text-zinc-500"
            style={{ fontSize: 13, lineHeight: "19px" }}
          >
            Thanks for following @mandysbubbletea!
          </p>
        </article>
      </div>
    );
  }

  // ----- Active state: ticket is available (mirrors LoyaltyCard layout) -----
  if (igFollowDiscount.available) {
    return (
      <div className="px-4 mt-3">
        <Link
          href="/menu"
          className="block rounded-card p-[22px] shadow-mini-cart transition-transform active:scale-[0.985] text-white"
          style={{
            background: `linear-gradient(135deg, ${BRAND.primaryColor} 0%, #6B3E15 100%)`,
          }}
        >
          <div className="flex items-start justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-peach" />
                <span
                  className="font-mono uppercase text-white/70"
                  style={{
                    fontSize: 10.5,
                    letterSpacing: 1.3,
                    fontWeight: 700,
                  }}
                >
                  IG FOLLOW REWARD
                </span>
              </div>
              <div className="mt-2 flex items-baseline">
                <span
                  className="font-serif text-white"
                  style={{
                    fontSize: 36,
                    lineHeight: "36px",
                    letterSpacing: -0.8,
                    fontWeight: 500,
                  }}
                >
                  10%
                </span>
                <span
                  className="font-serif text-white/45 ml-1.5"
                  style={{ fontSize: 18, fontWeight: 500 }}
                >
                  off your next drink
                </span>
              </div>
            </div>
            <span className="flex items-center gap-1 rounded-full bg-white/20 px-2.5 py-1.5">
              <Check size={12} className="text-peach" strokeWidth={3} />
              <span
                className="text-white"
                style={{ fontSize: 11, fontWeight: 500 }}
              >
                Active
              </span>
            </span>
          </div>

          <div className="mt-[18px] flex items-center justify-between">
            <p
              className="flex-1 pr-3 text-white/85"
              style={{ fontSize: 13, lineHeight: "19px" }}
            >
              Auto-applied to your cheapest drink at checkout.
            </p>
            <span className="flex items-center gap-1.5 rounded-full bg-peach px-3 py-1.5">
              <span
                className="text-brand-dark"
                style={{ fontSize: 12.5, fontWeight: 500 }}
              >
                Order now
              </span>
              <ArrowRight size={12} className="text-brand-dark" />
            </span>
          </div>
        </Link>
      </div>
    );
  }

  // ----- Locked state: not yet claimed (or guest) -----
  const isGuest = profile == null;
  const step2Disabled = !visited || busy;
  const step2Label = isGuest
    ? "Sign in to claim"
    : busy
      ? "Claiming…"
      : "I followed — claim my 10% off";
  const step2Href = isGuest ? "/auth?next=/account/promotions" : undefined;

  return (
    <div className="px-4 mt-3">
      <article className="rounded-card border border-black/10 bg-white p-[22px] shadow-mini-cart">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: BRAND.primaryColor }}
              />
              <span
                className="font-mono uppercase text-zinc-500"
                style={{
                  fontSize: 10.5,
                  letterSpacing: 1.3,
                  fontWeight: 700,
                }}
              >
                FOLLOW US ON INSTAGRAM
              </span>
            </div>
            <div className="mt-2 flex items-baseline">
              <span
                className="font-serif text-zinc-900"
                style={{
                  fontSize: 36,
                  lineHeight: "36px",
                  letterSpacing: -0.8,
                  fontWeight: 500,
                }}
              >
                10%
              </span>
              <span
                className="font-serif text-zinc-400 ml-1.5"
                style={{ fontSize: 18, fontWeight: 500 }}
              >
                off your next drink
              </span>
            </div>
          </div>
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px]"
            style={{
              background:
                "linear-gradient(135deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)",
            }}
          >
            <InstagramIcon className="h-5 w-5 text-white" />
          </div>
        </div>

        <p
          className="mt-3 text-zinc-600"
          style={{ fontSize: 13, lineHeight: "19px" }}
        >
          Follow @mandysbubbletea, then come back and claim your one-time 10%
          off code.
        </p>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <a
            href={IG_URL}
            target="_blank"
            rel="noreferrer noopener"
            onClick={handleStep1}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
            style={{ backgroundColor: BRAND.primaryColor }}
          >
            <InstagramIcon className="h-4 w-4 text-white" />
            <span>Follow on Instagram</span>
          </a>
          {step2Href ? (
            <Link
              href={step2Href}
              className="inline-flex flex-1 items-center justify-center rounded-full border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-800 transition hover:border-zinc-400"
            >
              {step2Label}
            </Link>
          ) : (
            <button
              type="button"
              onClick={handleClaim}
              disabled={step2Disabled}
              className="inline-flex flex-1 items-center justify-center rounded-full border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-800 transition enabled:hover:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {step2Label}
            </button>
          )}
        </div>

        {errMsg ? (
          <p className="mt-2 text-sm text-red-600" role="alert">
            {errMsg}
          </p>
        ) : null}
      </article>
    </div>
  );
}
