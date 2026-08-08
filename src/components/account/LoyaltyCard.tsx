"use client";

import Link from "next/link";
import { useRef, type CSSProperties } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Gem, Star } from "lucide-react";
import { StarTrack } from "@/components/account/StarTrack";
import {
  DIAMOND_MONTHLY_FREE_TOPPINGS,
  tierProgress,
  type MembershipTier,
} from "@/lib/membership-tier";

gsap.registerPlugin(useGSAP);

type LoyaltyCardProps = {
  balance: number;
  starsPerReward: number;
  lifetimePoints: number;
  freeToppingsRemaining?: number | null;
};

type TierVisual = {
  label: string;
  /** Metallic rim: gradient on a 1.5px frame around the card body. */
  rim: string;
  cardStyle: CSSProperties;
  shadow: string;
  /** Tint of the moving reflection band. */
  reflex: string;
  /** Fill of the hairline progress bar. */
  progressFill: string;
  /** Solid tier accent for the star track — a gradient can't fill an svg path. */
  starFill: string;
  sparkles: boolean;
  holo: boolean;
};

/**
 * Dark-luxe material stacks (top layer first): key light → grain → vignette →
 * base metal. Premium reads come from card proportions (1.6:1), a metallic
 * rim, deep tones, one tilt-bound moving reflection and lots of negative
 * space — not from decoration.
 */
const TIER_VISUALS: Record<MembershipTier, TierVisual> = {
  silver: {
    label: "SILVER",
    rim: "linear-gradient(155deg, rgba(255,255,255,0.75) 0%, rgba(130,140,158,0.30) 30%, rgba(18,22,32,0.85) 68%, rgba(190,198,212,0.55) 100%)",
    cardStyle: {
      background: [
        "radial-gradient(130% 170% at 20% -10%, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.04) 36%, transparent 58%)",
        "repeating-linear-gradient(100deg, rgba(255,255,255,0.03) 0 1px, rgba(0,0,0,0.045) 1px 2px, transparent 2px 3px)",
        "radial-gradient(150% 120% at 50% 130%, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.16) 38%, transparent 62%)",
        "linear-gradient(135deg, #2c313d 0%, #485064 30%, #707a8c 52%, #414958 76%, #2d3340 100%)",
      ].join(","),
      boxShadow:
        "inset 0 1px 1px rgba(255,255,255,0.22), inset 0 -2px 5px rgba(0,0,0,0.45)",
    },
    shadow: "0 20px 44px -20px rgba(10,14,24,0.65)",
    reflex: "rgba(255,255,255,0.12)",
    progressFill: "linear-gradient(90deg, #cdd4e0, #8a93a5)",
    starFill: "#DCE2EC",
    sparkles: false,
    holo: false,
  },
  gold: {
    label: "GOLD",
    rim: "linear-gradient(155deg, rgba(255,238,180,0.9) 0%, rgba(150,110,30,0.40) 30%, rgba(38,24,2,0.9) 68%, rgba(228,188,92,0.6) 100%)",
    cardStyle: {
      background: [
        "radial-gradient(130% 170% at 20% -10%, rgba(255,240,200,0.20) 0%, rgba(255,240,200,0.05) 36%, transparent 58%)",
        "repeating-linear-gradient(100deg, rgba(255,233,170,0.035) 0 1px, rgba(30,18,0,0.045) 1px 2px, transparent 2px 3px)",
        "radial-gradient(150% 120% at 50% 130%, rgba(20,12,0,0.50) 0%, rgba(20,12,0,0.18) 38%, transparent 62%)",
        "linear-gradient(135deg, #392a0d 0%, #654c16 30%, #c2a045 52%, #574012 76%, #322307 100%)",
      ].join(","),
      boxShadow:
        "inset 0 1px 1px rgba(255,235,180,0.26), inset 0 -2px 5px rgba(25,15,0,0.5)",
    },
    shadow: "0 20px 44px -20px rgba(40,26,0,0.65)",
    reflex: "rgba(255,241,200,0.13)",
    progressFill: "linear-gradient(90deg, #f0d489, #a87f2a)",
    starFill: "#F2DA95",
    sparkles: false,
    holo: false,
  },
  diamond: {
    label: "DIAMOND",
    rim: "linear-gradient(155deg, rgba(175,205,255,0.55) 0%, rgba(70,80,120,0.35) 30%, rgba(0,0,0,0.95) 68%, rgba(150,180,235,0.40) 100%)",
    cardStyle: {
      background: [
        "radial-gradient(130% 170% at 22% -10%, rgba(150,180,255,0.10) 0%, rgba(150,180,255,0.03) 36%, transparent 58%)",
        "linear-gradient(115deg, transparent 0 36%, rgba(142,197,255,0.05) 36% 41%, transparent 41%)",
        "linear-gradient(245deg, transparent 0 28%, rgba(255,158,230,0.04) 28% 33%, transparent 33%)",
        "radial-gradient(150% 120% at 50% 130%, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.22) 40%, transparent 64%)",
        "linear-gradient(135deg, #04050a 0%, #10121d 48%, #04050a 100%)",
      ].join(","),
      boxShadow:
        "inset 0 1px 1px rgba(170,200,255,0.15), inset 0 -2px 5px rgba(0,0,0,0.55)",
    },
    shadow: "0 20px 44px -20px rgba(0,0,0,0.75)",
    reflex: "rgba(190,215,255,0.10)",
    progressFill: "linear-gradient(90deg, #9db8ff, #d3b3f5)",
    starFill: "#C9BEFA",
    sparkles: true,
    holo: true,
  },
};

/** Fine photographic grain: kills gradient banding, reads as real material. */
const NOISE_BG = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E")`;

/** Deterministic sparkle placement so SSR + client render identically. */
const SPARKLES: { left: string; top: string; size: number }[] = [
  { left: "8%", top: "20%", size: 9 },
  { left: "88%", top: "14%", size: 11 },
  { left: "72%", top: "40%", size: 8 },
  { left: "20%", top: "64%", size: 10 },
  { left: "56%", top: "82%", size: 9 },
  { left: "92%", top: "70%", size: 10 },
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
  const TierIcon = tier === "diamond" ? Gem : Star;

  const wrapRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLAnchorElement>(null);
  const glareRef = useRef<HTMLSpanElement>(null);
  const reflexRef = useRef<HTMLSpanElement>(null);
  const holoRef = useRef<HTMLSpanElement>(null);

  useGSAP(
    (_, contextSafe) => {
      const card = cardRef.current;
      const reflex = reflexRef.current;
      if (!card || !reflex || !contextSafe) return;

      const mm = gsap.matchMedia();
      mm.add(
        {
          motionOK: "(prefers-reduced-motion: no-preference)",
          finePointer: "(pointer: fine)",
        },
        (ctx) => {
          if (!ctx.conditions?.motionOK) return;
          gsap.set(card, { transformPerspective: 900 });

        // ── entrance: smooth 3D reveal ──
        gsap.from(card, {
          rotationY: -42,
          y: 20,
          autoAlpha: 0,
          duration: 1.1,
          ease: "power4.out",
        });

        // ── idle: the reflection slowly breathes across the metal ──
        let idle: gsap.core.Tween | null = null;
        const startIdle = () => {
          idle = gsap.fromTo(
            reflex,
            { xPercent: -22 },
            {
              xPercent: 22,
              duration: 7,
              yoyo: true,
              repeat: -1,
              ease: "sine.inOut",
            },
          );
        };
        startIdle();

        if (holoRef.current) {
          gsap.to(holoRef.current, {
            rotation: 360,
            duration: 30,
            ease: "none",
            repeat: -1,
          });
        }
        gsap.utils
          .toArray<HTMLElement>(".js-tier-sparkle", card)
          .forEach((el, i) => {
            gsap.fromTo(
              el,
              { opacity: 0.08, scale: 0.5 },
              {
                opacity: 0.9,
                scale: 1,
                duration: gsap.utils.random(0.9, 1.6),
                repeat: -1,
                yoyo: true,
                ease: "sine.inOut",
                delay: i * 0.4,
              },
            );
          });

          const quick = { duration: 0.45, ease: "power2.out" } as const;
          const rxTo = gsap.quickTo(card, "rotationX", quick);
          const ryTo = gsap.quickTo(card, "rotationY", quick);
          const scaleTo = gsap.quickTo(card, "scale", { duration: 0.2, ease: "power2.out" });
          const reflexTo = gsap.quickTo(reflex, "xPercent", quick);
          const glare = glareRef.current;
          const gxTo = glare ? gsap.quickTo(glare, "x", quick) : null;
          const gyTo = glare ? gsap.quickTo(glare, "y", quick) : null;
          const goTo = glare ? gsap.quickTo(glare, "opacity", quick) : null;

          /** Drive tilt + reflection + glare from a normalized -0.5..0.5 pair. */
          const applyTilt = (px: number, py: number, glareOpacity: number) => {
            ryTo(px * 12);
            rxTo(-py * 8);
            reflexTo(px * 70);
            gxTo?.(px * card.offsetWidth * 0.6);
            gyTo?.(py * card.offsetHeight * 0.6);
            goTo?.(glareOpacity);
          };

          if (ctx.conditions.finePointer) {
            // ── desktop: tilt + glare + reflection follow the pointer ──
            const onMove = contextSafe((e: PointerEvent) => {
              const r = card.getBoundingClientRect();
              idle?.kill();
              idle = null;
              applyTilt(
                (e.clientX - r.left) / r.width - 0.5,
                (e.clientY - r.top) / r.height - 0.5,
                1,
              );
            });
            const onLeave = contextSafe(() => {
              rxTo(0);
              ryTo(0);
              goTo?.(0);
              scaleTo(1);
              if (!idle) {
                gsap.to(reflex, {
                  xPercent: -22,
                  duration: 1.2,
                  ease: "power2.inOut",
                  onComplete: startIdle,
                });
              }
            });
            const onDown = contextSafe(() => scaleTo(0.985));
            const onUp = contextSafe(() => scaleTo(1));

            card.addEventListener("pointermove", onMove);
            card.addEventListener("pointerleave", onLeave);
            card.addEventListener("pointerdown", onDown);
            card.addEventListener("pointerup", onUp);
            card.addEventListener("pointercancel", onLeave);
            return () => {
              card.removeEventListener("pointermove", onMove);
              card.removeEventListener("pointerleave", onLeave);
              card.removeEventListener("pointerdown", onDown);
              card.removeEventListener("pointerup", onUp);
              card.removeEventListener("pointercancel", onLeave);
            };
          }

          // ── mobile: gyroscope drives the card like a real one in hand ──
          // Until readings arrive (or when denied/unavailable) a gentle
          // floating sway keeps the 3D readable with zero input.
          let sway: gsap.core.Timeline | null = null;
          const startSway = () => {
            sway = gsap
              .timeline({ repeat: -1, yoyo: true, defaults: { ease: "sine.inOut" } })
              .to(card, { rotationY: 5, rotationX: -3, duration: 3.2 })
              .to(card, { rotationY: -4, rotationX: 2.5, duration: 3.2 });
          };
          startSway();

          let baseBeta: number | null = null;
          let baseGamma = 0;
          const onOrient = contextSafe((e: DeviceOrientationEvent) => {
            if (e.beta == null || e.gamma == null) return;
            if (baseBeta == null) {
              // first reading = neutral hand position
              baseBeta = e.beta;
              baseGamma = e.gamma;
              sway?.kill();
              sway = null;
            }
            const px = gsap.utils.clamp(-28, 28, e.gamma - baseGamma) / 56;
            const py = gsap.utils.clamp(-28, 28, e.beta - baseBeta) / 56;
            applyTilt(px, py, 0.8);
          });
          const attachGyro = () => window.addEventListener("deviceorientation", onOrient);

          // iOS 13+ gates the gyro behind a permission that must be requested
          // from a user gesture — prime it on the first touch anywhere.
          const doe = DeviceOrientationEvent as unknown as
            | { requestPermission?: () => Promise<string> }
            | undefined;
          const prime = contextSafe(() => {
            doe
              ?.requestPermission?.()
              .then((state) => {
                if (state === "granted") attachGyro();
              })
              .catch(() => {});
          });
          if (typeof DeviceOrientationEvent !== "undefined") {
            if (typeof doe?.requestPermission === "function") {
              window.addEventListener("touchend", prime, { once: true });
            } else {
              attachGyro();
            }
          }
          return () => {
            window.removeEventListener("deviceorientation", onOrient);
            window.removeEventListener("touchend", prime);
          };
        },
      );
    },
    { dependencies: [tier], revertOnUpdate: true, scope: wrapRef },
  );

  const progressPct = Math.min(100, Math.round((currentStars / goal) * 100));

  // Diamond-only: this month's free-topping allowance as a 10-pip bar.
  // `limit` is the checked-in constant (source of truth); only `remaining`
  // is dynamic. Hidden for other tiers / while the value is unknown.
  const showToppings = tier === "diamond" && freeToppingsRemaining != null;
  const toppingsLeft = showToppings
    ? Math.max(0, Math.min(DIAMOND_MONTHLY_FREE_TOPPINGS, freeToppingsRemaining))
    : 0;

  return (
    <div className="px-4 mt-3" ref={wrapRef}>
      {/* metallic rim: 1.5px gradient frame around the card body */}
      <Link
        href="/account/promotions"
        ref={cardRef}
        className="block rounded-card p-[1.5px]"
        style={{ background: visual.rim, boxShadow: visual.shadow }}
      >
        <div
          className={
            "relative flex flex-col overflow-hidden rounded-[18.5px] p-[22px] " +
            // Diamond carries an extra row (5% + free-toppings pips), so it
            // gets a slightly taller proportion; Silver/Gold keep the credit-
            // card 1.6:1. The min-h floor guarantees the fixed-height content
            // never clips at narrow widths where the aspect alone would be too
            // short (content is ~pixel-fixed, not width-scaled).
            (showToppings ? "aspect-[1.42/1] min-h-[216px]" : "aspect-[1.6/1]")
          }
          style={visual.cardStyle}
        >
          {/* ── Decorative layers (behind content, never intercept taps) ── */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{ background: NOISE_BG, mixBlendMode: "overlay" }}
          />
          {visual.holo && (
            <span
              ref={holoRef}
              aria-hidden="true"
              className="pointer-events-none absolute left-1/2 top-1/2 -ml-[75%] -mt-[75%] h-[150%] w-[150%]"
              style={{
                background:
                  "conic-gradient(from 0deg, rgba(255,158,230,0.10), rgba(142,197,255,0.14), rgba(157,255,206,0.10), rgba(255,217,143,0.10), rgba(255,158,230,0.10))",
                mixBlendMode: "overlay",
              }}
            />
          )}
          {/* tilt-bound reflection: one wide soft light that sweeps the metal */}
          <span
            ref={reflexRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              background: `linear-gradient(100deg, transparent 30%, ${visual.reflex} 48%, ${visual.reflex} 52%, transparent 70%)`,
            }}
          />
          {/* pointer-following specular glare */}
          <span
            ref={glareRef}
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 -ml-[60%] -mt-[60%] h-[120%] w-[120%] opacity-0"
            style={{
              background:
                "radial-gradient(circle, rgba(255,255,255,0.20) 0%, rgba(255,255,255,0.05) 35%, transparent 62%)",
            }}
          />
          {visual.sparkles &&
            SPARKLES.map((s, i) => (
              <span
                key={i}
                aria-hidden="true"
                className="js-tier-sparkle pointer-events-none absolute text-white"
                style={{
                  left: s.left,
                  top: s.top,
                  fontSize: s.size,
                  opacity: 0.08,
                  textShadow: "0 0 6px rgba(180,215,255,0.8)",
                }}
              >
                ✦
              </span>
            ))}
          {/* embossed brand monogram */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute select-none font-serif"
            style={{
              right: 16,
              bottom: -20,
              fontSize: 96,
              lineHeight: 1,
              fontWeight: 500,
              color: "rgba(255,255,255,0.05)",
              textShadow: "0 1px 0 rgba(0,0,0,0.25)",
            }}
          >
            M
          </span>

          {/* ── Card content ── */}
          <div className="relative z-10 flex h-full flex-col justify-between">
            <div className="flex items-start justify-between">
              <span
                className="font-mono uppercase text-white/50 pt-1"
                style={{ fontSize: 9.5, letterSpacing: 2.2, fontWeight: 700 }}
              >
                MANDY&apos;S REWARDS
              </span>
              <span
                className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5"
                style={{
                  border: "1px solid rgba(255,255,255,0.22)",
                  background: "rgba(255,255,255,0.04)",
                }}
              >
                <TierIcon
                  size={11}
                  className={
                    tier === "diamond" ? "text-[#8ec5ff]" : "text-peach"
                  }
                  fill={tier === "diamond" ? "none" : "currentColor"}
                />
                <span
                  className="text-white/90"
                  style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 1.6 }}
                >
                  {visual.label}
                </span>
              </span>
            </div>

            <div>
              <div className="flex items-baseline">
                <span
                  className="font-serif text-white"
                  style={{
                    fontSize: 40,
                    lineHeight: "40px",
                    letterSpacing: -1,
                    fontWeight: 500,
                    textShadow: "0 1px 2px rgba(0,0,0,0.30)",
                  }}
                >
                  {balance}
                </span>
                <span
                  className="font-serif text-white/40 ml-2"
                  style={{ fontSize: 20, fontWeight: 500 }}
                >
                  {`/ ${goal} stars`}
                </span>
              </div>
              {/* Progress toward the next free drink. Nine pips you can count
                  beats a bar you have to estimate — but only while they stay
                  countable, so an unusually large goal falls back to the
                  hairline rather than rendering 30 specks. */}
              {goal <= 12 ? (
                <StarTrack
                  balance={balance}
                  starsPerReward={goal}
                  fill={visual.starFill}
                />
              ) : (
                <div
                  className="mt-3 h-[3px] w-full overflow-hidden rounded-full"
                  style={{ background: "rgba(255,255,255,0.13)" }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${progressPct}%`,
                      background: visual.progressFill,
                    }}
                  />
                </div>
              )}

              {/* Diamond free-topping allowance — 10 pips, bright = available */}
              {showToppings && (
                <div className="mt-3.5">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span
                      className="flex items-center gap-1.5 text-white/80"
                      style={{ fontSize: 11 }}
                    >
                      <span style={{ fontSize: 12 }}>🧋</span>
                      Free toppings this month
                    </span>
                    {toppingsLeft > 0 ? (
                      <span
                        className="font-serif text-[#bfd6ff]"
                        style={{ fontSize: 11.5 }}
                      >
                        {`${toppingsLeft} of ${DIAMOND_MONTHLY_FREE_TOPPINGS} left`}
                      </span>
                    ) : (
                      <span className="text-white/40" style={{ fontSize: 10.5 }}>
                        used up · resets monthly
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1">
                    {Array.from({ length: DIAMOND_MONTHLY_FREE_TOPPINGS }).map(
                      (_, i) => (
                        <span
                          key={i}
                          className="h-[6px] flex-1 rounded-full"
                          style={{
                            background:
                              i < toppingsLeft
                                ? "linear-gradient(90deg,#8ec5ff,#bfd6ff)"
                                : "rgba(255,255,255,0.08)",
                          }}
                        />
                      ),
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-end justify-between">
              <div>
                <p
                  className="text-white/85"
                  style={{ fontSize: 13, lineHeight: "18px" }}
                >
                  {reached ? (
                    "Free drink ready to redeem"
                  ) : (
                    <>
                      <span className="text-white" style={{ fontWeight: 600 }}>
                        {toGo}
                      </span>
                      {" stars until a free drink"}
                    </>
                  )}
                </p>
                <p
                  className="mt-0.5 text-white/45"
                  style={{ fontSize: 11, lineHeight: "15px", letterSpacing: 0.3 }}
                >
                  {/* Diamond toppings now have their own pips block above;
                      subline stays on tier progress. */}
                  {starsToNext != null
                    ? `${starsToNext} stars to ${nextTier === "gold" ? "Gold" : "Diamond"}`
                    : "Top tier member"}
                </p>
              </div>
              <span
                className={
                  "rounded-full px-3.5 py-1.5 " + (reached ? "bg-peach" : "")
                }
                style={
                  reached
                    ? undefined
                    : { border: "1px solid rgba(255,255,255,0.22)" }
                }
              >
                <span
                  className={reached ? "text-brand-dark" : "text-white/90"}
                  style={{ fontSize: 12, fontWeight: 500, letterSpacing: 0.4 }}
                >
                  {reached ? "Redeem" : "View"}
                </span>
              </span>
            </div>
          </div>
        </div>
      </Link>
    </div>
  );
}
