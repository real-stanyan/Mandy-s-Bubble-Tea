"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { ArrowRight, Gem, Star } from "lucide-react";
import { StarCupsRow } from "@/components/brand/StarCupsRow";
import { tierProgress, type MembershipTier } from "@/lib/membership-tier";
import { useCardTilt } from "@/components/account/useCardTilt";

type LoyaltyCardProps = {
  balance: number;
  starsPerReward: number;
  lifetimePoints: number;
  freeToppingsRemaining?: number | null;
};

type TierVisual = {
  label: string;
  cardStyle: CSSProperties;
  shimmer: boolean;
  sparkles: boolean;
  holo: boolean;
};

const TIER_VISUALS: Record<MembershipTier, TierVisual> = {
  silver: {
    label: "SILVER",
    cardStyle: {
      // slightly darker stops than pure silver so white text keeps contrast
      background:
        "linear-gradient(135deg,#a3abb8 0%,#6f7987 35%,#b6bdc9 60%,#7e8796 100%)",
    },
    shimmer: false,
    sparkles: false,
    holo: false,
  },
  gold: {
    label: "GOLD",
    cardStyle: {
      background:
        "linear-gradient(135deg,#b98a2c 0%,#8a5f14 30%,#e9c25c 55%,#a47620 80%,#9c6f1d 100%)",
    },
    shimmer: true,
    sparkles: false,
    holo: false,
  },
  diamond: {
    label: "DIAMOND",
    cardStyle: {
      background:
        "linear-gradient(135deg,#11131a 0%,#1d2030 40%,#11131a 100%)",
    },
    shimmer: true,
    sparkles: true,
    holo: true,
  },
};

/** Deterministic sparkle placement so SSR + client render identically. */
const SPARKLES: { left: string; top: string; delay: string; size: number }[] = [
  { left: "8%", top: "18%", delay: "0s", size: 10 },
  { left: "88%", top: "12%", delay: "0.5s", size: 13 },
  { left: "70%", top: "38%", delay: "1.1s", size: 9 },
  { left: "22%", top: "62%", delay: "1.6s", size: 12 },
  { left: "55%", top: "80%", delay: "0.8s", size: 10 },
  { left: "92%", top: "68%", delay: "2.1s", size: 11 },
];

export function LoyaltyCard({
  balance,
  starsPerReward,
  lifetimePoints,
  freeToppingsRemaining,
}: LoyaltyCardProps) {
  const goal = starsPerReward > 0 ? starsPerReward : 1;
  const currentStars = balance % goal;
  const toGo = Math.max(0, goal - currentStars);
  const reached = balance >= goal;

  const { tier, nextTier, starsToNext } = tierProgress(lifetimePoints);
  const visual = TIER_VISUALS[tier];
  const tilt = useCardTilt<HTMLAnchorElement>();
  const TierIcon = tier === "diamond" ? Gem : Star;

  return (
    <div className="px-4 mt-3">
      <Link
        href="/account/promotions"
        ref={tilt.ref}
        {...tilt.handlers}
        className="relative block overflow-hidden rounded-card p-[22px] shadow-mini-cart transition-transform active:scale-[0.985]"
        style={{ ...visual.cardStyle, ...tilt.style }}
      >
        {/* ── Decorative layers (behind content, never intercept taps) ── */}
        {visual.holo && (
          <span
            aria-hidden="true"
            className="tier-holo pointer-events-none absolute inset-0"
            style={{
              background:
                "linear-gradient(115deg, rgba(255,158,230,.20) 10%, rgba(142,197,255,.27) 35%, rgba(157,255,206,.20) 60%, rgba(255,217,143,.20) 85%)",
              backgroundSize: "200% 200%",
              mixBlendMode: "overlay",
            }}
          />
        )}
        {visual.shimmer && (
          <span
            aria-hidden="true"
            className="tier-shimmer pointer-events-none absolute inset-0"
            style={{
              background:
                "linear-gradient(105deg, transparent 40%, rgba(255,255,255,.35) 50%, transparent 60%)",
            }}
          />
        )}
        {visual.sparkles &&
          SPARKLES.map((s, i) => (
            <span
              key={i}
              aria-hidden="true"
              className="tier-sparkle pointer-events-none absolute text-white"
              style={{
                left: s.left,
                top: s.top,
                fontSize: s.size,
                animationDelay: s.delay,
                textShadow: "0 0 6px rgba(180,215,255,0.9)",
              }}
            >
              ✦
            </span>
          ))}

        {/* ── Card content ── */}
        <div className="relative z-10">
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
                  MANDY&apos;S REWARDS
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
                  {balance}
                </span>
                <span
                  className="font-serif text-white/45 ml-1.5"
                  style={{ fontSize: 24, fontWeight: 500 }}
                >
                  {` / ${goal} stars`}
                </span>
              </div>
            </div>
            <span className="flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1.5">
              <TierIcon
                size={12}
                className={tier === "diamond" ? "text-[#8ec5ff]" : "text-peach"}
                fill={tier === "diamond" ? "none" : "currentColor"}
              />
              <span
                className="text-white"
                style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.8 }}
              >
                {visual.label}
              </span>
            </span>
          </div>

          <StarCupsRow value={currentStars} total={goal} />

          <p
            className="mt-1.5 text-white/65"
            style={{ fontSize: 11.5, lineHeight: "16px" }}
          >
            {starsToNext != null
              ? `${starsToNext} ⭐ to ${nextTier === "gold" ? "Gold" : "Diamond"}`
              : "Top tier member"}
          </p>
          {tier === "diamond" && freeToppingsRemaining != null && (
            <p
              className="mt-0.5 text-white/65"
              style={{ fontSize: 11.5, lineHeight: "16px" }}
            >
              {freeToppingsRemaining} free toppings left this month
            </p>
          )}

          <div className="mt-[18px] flex items-center justify-between">
            <p
              className="flex-1 pr-3 text-white/85"
              style={{ fontSize: 13, lineHeight: "19px" }}
            >
              {reached ? (
                <>🎉 Free drink ready to redeem</>
              ) : (
                <>
                  <span className="text-white" style={{ fontWeight: 600 }}>
                    {toGo}
                  </span>
                  {" stars until a free drink"}
                </>
              )}
            </p>
            <span
              className={
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 " +
                (reached ? "bg-peach" : "bg-white/20")
              }
            >
              <span
                className={reached ? "text-brand-dark" : "text-white"}
                style={{ fontSize: 12.5, fontWeight: 500 }}
              >
                {reached ? "Redeem" : "View"}
              </span>
              <ArrowRight
                size={12}
                className={reached ? "text-brand-dark" : "text-white"}
              />
            </span>
          </div>
        </div>
      </Link>
    </div>
  );
}
