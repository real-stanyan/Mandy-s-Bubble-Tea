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
// Geometry traced from the shop's own Weekly Specials poster (2026-08-08), not
// invented: the real cup is tall and near-straight-sided (~2.5:1, base ~85% of
// the rim), film-sealed under a FLAT lid, and carries the MANDY'S wordmark.
// The first pass drew a squat, steeply tapered cup with a domed lid and a
// straw — a generic takeaway cup, not theirs.
//
// Toppings are drawn as BEDS, not loose pieces. One topping is a layer sitting
// in the bottom of the cup, the way it looks in a real one; a single pearl
// floating alone read as a mistake.

const LIQUID_TOP = 58;
const CUP_FLOOR = 175;
/** Height of one bed of pieces. */
const BED_H = 9;
/** Beds past this stop being legible and start filling the whole cup. */
const MAX_BEDS = 6;

// Interior wall, so a bed can be cut to the cup's taper instead of running
// through the sides. Interior spans x 28.5–91.5 at y=44 and x 34–86 at
// y=180.5. (First trace of the poster came out a shade too tall and thin
// for the panel — this is the same cup let out ~10% in the waist and taken
// in ~9% in the height, still near-straight-sided.)
const HALF_AT_TOP = 31.5;
const TAPER_PER_PX = (31.5 - 26) / (180.5 - 44);
function halfWidthAt(y: number): number {
  return HALF_AT_TOP - (y - 44) * TAPER_PER_PX;
}

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
    visual.ice === "extra" ? 6 : visual.ice === "normal" ? 5 : visual.ice === "less" ? 2 : 0;

  // Sugar reads as richness. Kept narrow — a "no sugar" drink is still a
  // drink, not a glass of water.
  const liquidOpacity = Math.min(1, 0.74 + Math.min(visual.sugar, 1) * 0.26);

  const sunken = visual.toppings.filter((t) => t.placement === "bottom");
  const floating = visual.toppings.filter((t) => t.placement === "top");

  // Beds stack upward from the floor. Each topping gets one bed, plus a
  // second when the customer asked for more than one of it.
  const beds: Array<{ t: ToppingVisual; y: number }> = [];
  let level = 0;
  for (const t of sunken) {
    const depth = Math.min(t.count, 2);
    for (let d = 0; d < depth && level < MAX_BEDS; d++) {
      beds.push({ t, y: CUP_FLOOR - level * BED_H });
      level++;
    }
  }

  const foamTop = LIQUID_TOP;
  const foamHeight = 17;
  const bruleeTop = visual.hasFoam ? foamTop - 5 : LIQUID_TOP - 3;

  return (
    <figure className="m-0 flex items-center gap-4">
      <svg
        viewBox="0 0 120 196"
        // Compact on phones: the panel rides sticky above the modifier lists
        // there, and every pixel it holds is a pixel of the form it covers.
        // Two thirds of its old size on desktop too: the card pins to the top
        // of the modal, and every pixel it keeps is a pixel the toppings grid
        // under it does not get (Stan, 2026-09-06).
        className="h-[92px] w-auto shrink-0 select-none md:h-[118px]"
        role="presentation"
        aria-hidden="true"
      >
        <defs>
          <clipPath id={clipId}>
            <path d="M28.5,44 L91.5,44 L87,176 Q86.5,180.5 81.5,180.5 L38.5,180.5 Q33.5,180.5 33,176 Z" />
          </clipPath>
          <linearGradient id={liquidId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={visual.liquidLight} />
            <stop offset="55%" stopColor={visual.liquid} />
            <stop offset="100%" stopColor={visual.liquid} />
          </linearGradient>
        </defs>

        <g clipPath={`url(#${clipId})`}>
          {/* Pale interior so a low-sugar (more transparent) liquid has
              something to sit on rather than showing the page through it. */}
          <rect x="25" y="40" width="70" height="145" fill="#FDFAF4" />

          <rect
            x="25"
            y={LIQUID_TOP}
            width="70"
            height={187 - LIQUID_TOP}
            fill={`url(#${liquidId})`}
            opacity={liquidOpacity}
          />

          <ellipse
            cx="60"
            cy={LIQUID_TOP}
            rx={halfWidthAt(LIQUID_TOP)}
            ry="3.2"
            fill={visual.liquidLight}
            opacity={Math.min(1, liquidOpacity + 0.1)}
          />

          {beds.map((b, i) => (
            <Bed
              key={`${b.t.name}-${i}`}
              topping={b.t}
              y={b.y}
              // Beds land bottom-up, in the order they were stacked.
              delayMs={i * 70}
            />
          ))}

          {visual.hasFoam && (
            <g className="mbt-cup-drop">
              <rect x="25" y={foamTop} width="70" height={foamHeight} fill="#FBF1DF" />
              <ellipse
                cx="60"
                cy={foamTop + foamHeight}
                rx={halfWidthAt(foamTop + foamHeight)}
                ry="3"
                fill="#F3E4CB"
              />
              <ellipse cx="60" cy={foamTop} rx={halfWidthAt(foamTop)} ry="3.2" fill="#FFF9EE" />
            </g>
          )}

          {/* Crushed cookie floats — it belongs above the liquid and above
              the cheese cream, not in the pile at the bottom. */}
          {floating.map((t) => (
            <CrumbLayer
              key={t.name}
              topping={t}
              y={visual.hasFoam ? foamTop - 2 : LIQUID_TOP - 2}
            />
          ))}

          {visual.hasBrulee && (
            <g className="mbt-cup-drop">
              <rect x="25" y={bruleeTop} width="70" height="7" fill="#C98A3C" />
              <ellipse
                cx="60"
                cy={bruleeTop}
                rx={halfWidthAt(bruleeTop)}
                ry="3"
                fill="#E0A557"
              />
              <circle cx="51" cy={bruleeTop + 3} r="1.5" fill="#A96A26" />
              <circle cx="65" cy={bruleeTop + 4} r="1.2" fill="#A96A26" />
              <circle cx="72" cy={bruleeTop + 2.5} r="1" fill="#A96A26" />
            </g>
          )}

          {Array.from({ length: iceCount }).map((_, i) => {
            const [x, y, rot] = ICE_SLOTS[i];
            return (
              <rect
                key={`ice-${visual.ice}-${i}`}
                className="mbt-cup-drop"
                style={{ animationDelay: `${i * 55}ms` }}
                x={x - 5.5}
                y={y - 5.5}
                width="11"
                height="11"
                rx="3"
                fill="#FFFFFF"
                opacity="0.42"
                transform={`rotate(${rot} ${x} ${y})`}
              />
            );
          })}

        </g>

        {/* Cup wall, drawn over the fill so the edge stays crisp. */}
        <path
          d="M26,41 L94,41 L89.5,177 Q89,183 83,183 L37,183 Q31,183 30.5,177 Z"
          fill="none"
          stroke="#2A1E14"
          strokeOpacity="0.17"
          strokeWidth="2"
          strokeLinejoin="round"
        />

        {/* Straw, punched through the seal. Drawn BEFORE the lid so the lid
            overlaps it and it reads as going in rather than resting on top. */}
        <g transform="rotate(12 70 36)">
          <rect
            x="65.5"
            y="5"
            width="9"
            height="33"
            rx="4.5"
            fill="#F4E4CB"
            stroke="#E0CDAE"
            strokeWidth="1.2"
          />
        </g>

        {/* Flat sealed lid — a disc a little wider than the rim, with the
            lip below it. */}
        <rect
          x="22"
          y="32"
          width="76"
          height="7"
          rx="3.5"
          fill="#F7EFE1"
          stroke="#2A1E14"
          strokeOpacity="0.17"
          strokeWidth="2"
        />
        <rect
          x="24.5"
          y="38"
          width="71"
          height="5"
          rx="2"
          fill="#EFE3CE"
          stroke="#2A1E14"
          strokeOpacity="0.14"
          strokeWidth="1.4"
        />

        {visual.ice === "warm" && (
          <g fill="none" stroke="#C9B79E" strokeWidth="2" strokeLinecap="round">
            <path className="mbt-cup-steam" d="M48,27 q4,-6 0,-12" />
            <path
              className="mbt-cup-steam"
              style={{ animationDelay: "900ms" }}
              d="M60,24 q4,-7 0,-14"
            />
            <path
              className="mbt-cup-steam"
              style={{ animationDelay: "1700ms" }}
              d="M72,27 q4,-6 0,-12"
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

/** Ice rides high, the way it mounds under the lid on the real cups. */
const ICE_SLOTS: Array<[number, number, number]> = [
  [50, 70, -12],
  [66, 66, 9],
  [74, 78, 18],
  [46, 84, -5],
  [62, 88, 13],
  [72, 96, -9],
];

/**
 * One layer of a topping, packed across the cup at that height. Pieces are
 * evenly spaced rather than scattered: random placement re-rolls on every
 * unrelated re-render, and pearls that twitch when you change the quantity
 * read as a bug.
 */
function Bed({
  topping,
  y,
  delayMs,
}: {
  topping: ToppingVisual;
  y: number;
  delayMs: number;
}) {
  const half = halfWidthAt(y) - 2;
  const size = topping.shape === "pearl" ? 9.5 : 8.5;
  const per = Math.max(3, Math.floor((half * 2) / (size + 0.5)));
  const step = (half * 2) / per;
  const startX = 60 - half + step / 2;

  return (
    <g className="mbt-cup-drop" style={{ animationDelay: `${delayMs}ms` }}>
      {Array.from({ length: per }).map((_, i) => {
        const cx = startX + i * step;
        const color = topping.colors[i % topping.colors.length];
        if (topping.shape === "cube") {
          return (
            <rect
              key={i}
              x={cx - size / 2}
              y={y - size / 2}
              width={size}
              height={size}
              rx="2"
              fill={color}
              opacity="0.94"
              // A fixed alternating tilt, so a bed of jelly reads as loose
              // cubes rather than a printed stripe.
              transform={`rotate(${i % 2 === 0 ? -9 : 8} ${cx} ${y})`}
            />
          );
        }
        return (
          <circle
            key={i}
            cx={cx}
            cy={y}
            r={size / 2}
            fill={color}
            opacity={topping.shape === "pearl" ? 1 : 0.94}
          />
        );
      })}
    </g>
  );
}

/** Crushed cookie scattered on the surface. */
function CrumbLayer({ topping, y }: { topping: ToppingVisual; y: number }) {
  const half = halfWidthAt(y) - 2.5;
  const color = topping.colors[0];
  const crumbs = [
    [-0.82, 0, 2.3],
    [-0.5, 2.3, 1.6],
    [-0.16, -0.6, 2.7],
    [0.18, 1.8, 1.8],
    [0.5, -0.2, 2.4],
    [0.8, 2.0, 1.6],
    [-0.66, 3.3, 1.4],
    [0.34, 3.4, 1.5],
  ] as const;

  return (
    <g className="mbt-cup-drop">
      <rect x={60 - half} y={y} width={half * 2} height="4" rx="2" fill={color} opacity="0.9" />
      {crumbs.map(([fx, dy, r], i) => (
        <circle key={i} cx={60 + fx * half} cy={y + dy} r={r} fill={color} opacity="0.92" />
      ))}
    </g>
  );
}
