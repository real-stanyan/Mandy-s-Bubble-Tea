"use client";

import { useId } from "react";
import type { CupVisual, ToppingVisual } from "@/lib/menu/cup-visual";
import { describeCup } from "@/lib/menu/cup-visual";

// The drink the customer is building, drawn as they build it.
//
// Decoration, deliberately: the form below it is still where every choice is
// made and read back in words. That is why the svg is aria-hidden and the
// caption carries the same information as text — a cup that fails to draw a
// topping we've never seen before costs nothing, while a cup that people
// order from would have to be exhaustively correct.
//
// Positions are a fixed table rather than anything random. Random placement
// re-rolls on every keystroke elsewhere in the form, and pearls that twitch
// when you change the quantity read as a bug.

const LIQUID_TOP = 62;

/** Pile order: bottom-centre first, then outward and upward. */
const TOPPING_SLOTS: Array<[number, number]> = [
  [60, 140],
  [50, 142],
  [70, 142],
  [41, 139],
  [79, 139],
  [55, 131],
  [66, 131],
  [45, 130],
  [75, 130],
  [60, 123],
  [50, 122],
  [70, 122],
  [40, 121],
  [80, 121],
];

/** Ice sits high in the cup; the 4th slot only appears at "normal". */
const ICE_SLOTS: Array<[number, number, number]> = [
  [47, 75, -12],
  [64, 70, 9],
  [76, 82, 18],
  [54, 88, -5],
];

type Props = {
  visual: CupVisual;
  /** Shown above the caption — the drink being built. */
  drinkName: string;
};

export function CupPreview({ visual, drinkName }: Props) {
  // useId keeps the gradient/clip ids unique when two cups share a page (the
  // route page and the intercepting modal can both be mounted mid-transition).
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const clipId = `cupClip${uid}`;
  const liquidId = `cupLiquid${uid}`;

  const iceCount =
    visual.ice === "normal" ? 4 : visual.ice === "less" ? 2 : 0;

  // Sugar reads as richness. Kept narrow (0.74–1) — a "no sugar" drink is
  // still a drink, not a glass of water.
  const liquidOpacity = 0.74 + visual.sugar * 0.26;

  // Cheese cream and brûlée both occupy the top of the liquid; brûlée sits on
  // whatever is beneath it.
  const foamTop = LIQUID_TOP;
  const foamHeight = 15;
  const bruleeTop = visual.hasFoam ? foamTop - 5 : LIQUID_TOP - 3;

  return (
    <figure className="m-0 flex items-center gap-4">
      <svg
        viewBox="0 0 120 172"
        className="h-[150px] w-auto shrink-0 select-none"
        role="presentation"
        aria-hidden="true"
      >
        <defs>
          <clipPath id={clipId}>
            <path d="M27,49 L93,49 L82.5,145 Q82,149 77.5,149 L42.5,149 Q38,149 37.5,145 Z" />
          </clipPath>
          <linearGradient id={liquidId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={visual.liquidLight} />
            <stop offset="55%" stopColor={visual.liquid} />
            <stop offset="100%" stopColor={visual.liquid} />
          </linearGradient>
        </defs>

        {/* Straw — behind the lid dome so it reads as going through it. */}
        <g transform="rotate(13 68 60)">
          <rect
            x="63"
            y="6"
            width="10"
            height="70"
            rx="5"
            fill="#F4E4CB"
            stroke="#E0CDAE"
            strokeWidth="1.2"
          />
        </g>

        {/* Cup interior — pale, so a low-sugar (more transparent) liquid has
            something to sit on rather than showing the page through it. */}
        <g clipPath={`url(#${clipId})`}>
          <rect x="20" y="40" width="80" height="115" fill="#FDFAF4" />

          <rect
            x="20"
            y={LIQUID_TOP}
            width="80"
            height={155 - LIQUID_TOP}
            fill={`url(#${liquidId})`}
            opacity={liquidOpacity}
          />

          {/* Meniscus — the reason the liquid reads as liquid. */}
          <ellipse
            cx="60"
            cy={LIQUID_TOP}
            rx="33"
            ry="3.4"
            fill={visual.liquidLight}
            opacity={Math.min(1, liquidOpacity + 0.1)}
          />

          {visual.hasFoam && (
            <g className="mbt-cup-drop">
              <rect x="20" y={foamTop} width="80" height={foamHeight} fill="#FBF1DF" />
              <ellipse cx="60" cy={foamTop + foamHeight} rx="33" ry="3.2" fill="#F3E4CB" />
              <ellipse cx="60" cy={foamTop} rx="33" ry="3.4" fill="#FFF9EE" />
            </g>
          )}

          {visual.hasBrulee && (
            <g className="mbt-cup-drop">
              <rect x="20" y={bruleeTop} width="80" height="7" fill="#C98A3C" />
              <ellipse cx="60" cy={bruleeTop} rx="33" ry="3.2" fill="#E0A557" />
              <circle cx="48" cy={bruleeTop + 3} r="1.5" fill="#A96A26" />
              <circle cx="66" cy={bruleeTop + 4} r="1.2" fill="#A96A26" />
              <circle cx="75" cy={bruleeTop + 2.5} r="1" fill="#A96A26" />
            </g>
          )}

          {Array.from({ length: iceCount }).map((_, i) => {
            const [x, y, rot] = ICE_SLOTS[i];
            return (
              <rect
                key={`ice-${visual.ice}-${i}`}
                className="mbt-cup-drop"
                style={{ animationDelay: `${i * 55}ms` }}
                x={x - 6}
                y={y - 6}
                width="12"
                height="12"
                rx="3"
                fill="#FFFFFF"
                opacity="0.42"
                transform={`rotate(${rot} ${x} ${y})`}
              />
            );
          })}

          <Toppings toppings={visual.toppings} />
        </g>

        {/* Cup outline, drawn over the fill so the rim stays crisp. */}
        <path
          d="M24,46 L96,46 L85,146 Q84,152 78,152 L42,152 Q36,152 35,146 Z"
          fill="none"
          stroke="#2A1E14"
          strokeOpacity="0.16"
          strokeWidth="2"
          strokeLinejoin="round"
        />

        {/* Lid */}
        <path
          d="M18,46 Q18,29 60,29 Q102,29 102,46 Z"
          fill="#F7EFE1"
          stroke="#2A1E14"
          strokeOpacity="0.16"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <rect
          x="16"
          y="44"
          width="88"
          height="5"
          rx="2.5"
          fill="#EFE3CE"
          stroke="#2A1E14"
          strokeOpacity="0.14"
          strokeWidth="1.4"
        />

        {visual.ice === "warm" && (
          <g fill="none" stroke="#C9B79E" strokeWidth="2" strokeLinecap="round">
            <path className="mbt-cup-steam" d="M48,24 q4,-6 0,-12" />
            <path
              className="mbt-cup-steam"
              style={{ animationDelay: "900ms" }}
              d="M60,21 q4,-7 0,-14"
            />
            <path
              className="mbt-cup-steam"
              style={{ animationDelay: "1700ms" }}
              d="M72,24 q4,-6 0,-12"
            />
          </g>
        )}
      </svg>

      <figcaption className="min-w-0">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.13em] text-brand">
          Your cup
        </p>
        <p className="mt-1 text-[14px] font-semibold leading-snug text-ink">
          {drinkName}
        </p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink3">
          {describeCup(visual)}
        </p>
      </figcaption>
    </figure>
  );
}

function Toppings({ toppings }: { toppings: ToppingVisual[] }) {
  // Flatten picks into individual pieces, then hand each one the next slot.
  // Capped at the slot table's length — past that the cup stops looking like
  // a drink and starts looking like a jar, and the caption already says the
  // real number.
  const pieces: Array<{ key: string; t: ToppingVisual }> = [];
  for (const t of toppings) {
    const each = Math.min(t.count, 4);
    for (let i = 0; i < each; i++) {
      pieces.push({ key: `${t.name}-${i}`, t });
    }
  }

  return (
    <>
      {pieces.slice(0, TOPPING_SLOTS.length).map((p, i) => {
        const [x, y] = TOPPING_SLOTS[i];
        const delay = { animationDelay: `${i * 45}ms` };
        if (p.t.shape === "cube") {
          return (
            <rect
              key={p.key}
              className="mbt-cup-drop"
              style={delay}
              x={x - 4.5}
              y={y - 4.5}
              width="9"
              height="9"
              rx="2"
              fill={p.t.color}
              opacity="0.92"
              transform={`rotate(${(i % 4) * 15 - 22} ${x} ${y})`}
            />
          );
        }
        return (
          <circle
            key={p.key}
            className="mbt-cup-drop"
            style={delay}
            cx={x}
            cy={y}
            r={p.t.shape === "pearl" ? 5.1 : 4.5}
            fill={p.t.color}
            opacity={p.t.shape === "pearl" ? 1 : 0.92}
          />
        );
      })}
    </>
  );
}
