"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";

// A short, non-blocking celebration: a confetti fall from the top of the
// viewport and a check bubble that pops in the middle, then everything
// fades. Nothing is clickable, nothing scrolls, and it is over in about
// two seconds — long enough to feel like a moment, short enough to never
// stand between the customer and their pickup number. Reduced motion
// gets the bubble only, held briefly.

const CONFETTI_COUNT = 46;
const PALETTE = ["#FFB380", "#F2B64A", "#8D5524", "#FFF3DE", "#A2AD91", "#3CA96E"];
const DURATION_MS = 2400;

/** Deterministic pseudo-random in [0, 1) from an index — keeps render stable. */
function jitter(i: number, salt: number): number {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export function Celebration({
  active,
  title = "Order placed!",
  subtitle,
}: {
  active: boolean;
  title?: string;
  subtitle?: string;
}) {
  const [showing, setShowing] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (!active) return;
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setReduced(reduce);
    setShowing(true);
    const t = window.setTimeout(() => setShowing(false), reduce ? 1400 : DURATION_MS);
    return () => window.clearTimeout(t);
  }, [active]);

  if (!showing) return null;

  return (
    <div
      className="celebrate-layer pointer-events-none fixed inset-0 z-50 overflow-hidden"
      aria-hidden="true"
    >
      {!reduced &&
        Array.from({ length: CONFETTI_COUNT }, (_, i) => {
          const size = 6 + Math.round(jitter(i, 2) * 7);
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
                animationDelay: `${(jitter(i, 5) * 0.8).toFixed(2)}s`,
              }}
            />
          );
        })}
      <div className="flex h-full items-center justify-center px-6">
        <div className="celebrate-toast flex flex-col items-center rounded-card bg-card px-8 py-6 text-center shadow-[0_24px_60px_rgba(42,30,20,0.28)] ring-1 ring-line">
          <span className="celebrate-check grid h-16 w-16 place-items-center rounded-full bg-green text-white">
            <Check size={30} strokeWidth={3} />
          </span>
          <p className="mt-3 font-serif text-[22px] font-semibold tracking-[-0.3px] text-ink">
            {title}
          </p>
          {subtitle ? (
            <p className="mt-1 text-[13px] text-ink3">{subtitle}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
