"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
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

  useEffect(() => {
    setVisited(
      typeof window !== "undefined" &&
        window.localStorage.getItem(VISITED_KEY) === "1",
    );
  }, []);

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

  // ----- Active state: ticket is available -----
  if (igFollowDiscount.available) {
    return (
      <article
        className="rounded-2xl p-5 text-white"
        style={{ backgroundColor: BRAND.primaryColor }}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">10% Off Your Next Drink</h3>
          <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs font-medium">
            ACTIVE
          </span>
        </div>
        <p className="mt-1 text-sm text-white/85">
          Auto-applied to your cheapest drink at checkout. Thanks for following!
        </p>
      </article>
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
    <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <InstagramIcon className="h-5 w-5 text-zinc-700" />
        <h3 className="text-lg font-semibold text-zinc-900">
          Follow us for 10% off
        </h3>
      </div>
      <p className="mt-1 text-sm text-zinc-600">
        Follow @mandysbubbletea on Instagram and we&apos;ll drop a one-time 10% off
        on your next drink.
      </p>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <a
          href={IG_URL}
          target="_blank"
          rel="noreferrer noopener"
          onClick={handleStep1}
          className="inline-flex flex-1 items-center justify-center rounded-full px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
          style={{ backgroundColor: BRAND.primaryColor }}
        >
          Follow on Instagram
        </a>
        {step2Href ? (
          <Link
            href={step2Href}
            className="inline-flex flex-1 items-center justify-center rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 transition hover:border-zinc-400"
          >
            {step2Label}
          </Link>
        ) : (
          <button
            type="button"
            onClick={handleClaim}
            disabled={step2Disabled}
            className="inline-flex flex-1 items-center justify-center rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 transition enabled:hover:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-50"
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
  );
}
