"use client";

import { useEffect, useState } from "react";
import type { MembershipTier } from "@/lib/membership-tier";
import { LAST_TIER_STORAGE_KEY, shouldCelebrate } from "@/lib/tier-up";

const CELEBRATION_MS = 2800;
const CONFETTI_COUNT = 40;
const PALETTE = ["#FFB380", "#e9c25c", "#8ec5ff", "#ffffff", "#9dffce"];

const TOAST: Record<
  Exclude<MembershipTier, "silver">,
  { text: string; background: string }
> = {
  gold: {
    text: "Welcome to Gold! 🎉",
    background:
      "linear-gradient(135deg,#b98a2c 0%,#8a5f14 30%,#e9c25c 55%,#a47620 80%,#9c6f1d 100%)",
  },
  diamond: {
    text: "Welcome to Diamond! 💎",
    background: "linear-gradient(135deg,#11131a 0%,#1d2030 40%,#11131a 100%)",
  },
};

/** Deterministic pseudo-random in [0, 1) from an index — keeps render stable. */
function jitter(i: number, salt: number): number {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

type TierUpCelebrationProps = {
  tier: MembershipTier;
};

export function TierUpCelebration({ tier }: TierUpCelebrationProps) {
  const [celebrating, setCelebrating] = useState<"gold" | "diamond" | null>(
    null,
  );
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    let prev: string | null = null;
    try {
      prev = window.localStorage.getItem(LAST_TIER_STORAGE_KEY);
      // Always record the tier this device just saw.
      window.localStorage.setItem(LAST_TIER_STORAGE_KEY, tier);
    } catch {
      return; // storage unavailable (private mode) — skip celebration
    }
    if (!shouldCelebrate(prev, tier) || tier === "silver") return;

    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setReducedMotion(reduce);
    setCelebrating(tier);
    const timer = window.setTimeout(
      () => setCelebrating(null),
      reduce ? 1800 : CELEBRATION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [tier]);

  if (!celebrating) return null;
  const toast = TOAST[celebrating];

  return (
    <div
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden"
      aria-hidden="true"
    >
      {!reducedMotion &&
        Array.from({ length: CONFETTI_COUNT }, (_, i) => {
          const size = 6 + Math.round(jitter(i, 2) * 6); // 6–12px
          return (
            <span
              key={i}
              className="tier-confetti absolute top-0 block"
              style={{
                left: `${(i / CONFETTI_COUNT) * 100 + jitter(i, 1) * 2}%`,
                width: size,
                height: size * (jitter(i, 3) > 0.5 ? 0.45 : 1),
                borderRadius: jitter(i, 4) > 0.6 ? "50%" : 2,
                backgroundColor: PALETTE[i % PALETTE.length],
                animationDelay: `${(jitter(i, 5) * 0.9).toFixed(2)}s`,
              }}
            />
          );
        })}
      <div className="flex h-full items-center justify-center px-6">
        <div
          className="rounded-card px-7 py-5 text-center shadow-mini-cart"
          style={{ background: toast.background }}
        >
          <p
            className="font-serif text-white"
            style={{ fontSize: 22, fontWeight: 500, letterSpacing: -0.3 }}
          >
            {toast.text}
          </p>
          <p
            className="mt-1 text-white/70"
            style={{ fontSize: 12.5, letterSpacing: 0.4 }}
          >
            New member perks unlocked
          </p>
        </div>
      </div>
    </div>
  );
}
