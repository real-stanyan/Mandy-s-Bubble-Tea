"use client";

import { starTrack } from "@/lib/loyalty-stars";
import { resolveCupVisual } from "@/lib/menu/cup-visual";

// The membership card's progress toward a free drink — one pip per star, and
// when we know which cup earned a star, the pip IS that cup: a tiny drink in
// its real colour. Nine drinks you recognise beats nine abstract stars, and
// both beat 78% of a hairline bar.
//
// Attribution is best-effort (see lib/loyalty-star-drinks.ts). A star we
// can't trace stays a plain star, so progress never looks wrong just because
// an adjustment or a fetch miss left a gap. The emphasis is still rationed:
// only the star you are about to earn pulses, and only within two of a
// reward — the 2026-08-08 pull found 193 customers sitting there.

type Props = {
  balance: number;
  starsPerReward: number;
  /** Tier accent, used for earned stars so the track matches the card. */
  fill: string;
  /**
   * Drink that earned each star of this cycle, oldest first — index i maps
   * to filled pip i. null entries (and an entirely absent array) fall back
   * to plain stars.
   */
  drinks?: Array<string | null> | null;
};

export function StarTrack({ balance, starsPerReward, fill, drinks }: Props) {
  const track = starTrack(balance, starsPerReward);

  return (
    <div className="mt-3">
      <div
        className={
          "flex items-end gap-[3px] rounded-full " +
          (track.rewardReady ? "mbt-star-shimmer" : "")
        }
        role="img"
        aria-label={
          track.rewardReady
            ? `${starsPerReward} of ${starsPerReward} stars — free drink ready`
            : `${starsPerReward - track.remaining} of ${starsPerReward} stars`
        }
      >
        {track.states.map((state, i) => {
          const drinkName = state === "filled" ? (drinks?.[i] ?? null) : null;
          return drinkName ? (
            <MiniCup
              key={i}
              drinkName={drinkName}
              delayMs={i * 55}
            />
          ) : (
            <Star
              key={i}
              state={state}
              fill={fill}
              // Earned stars land left to right on first paint. Empty ones
              // have nothing to announce, so they just appear.
              delayMs={state === "filled" ? i * 55 : 0}
            />
          );
        })}
      </div>

      {track.nudge && (
        <p
          className="mt-2 text-[11.5px] font-semibold leading-none"
          style={{ color: track.rewardReady ? fill : "rgba(255,255,255,0.72)" }}
        >
          {track.nudge}
        </p>
      )}
    </div>
  );
}

/** A star that earned its drink, drawn AS that drink. */
function MiniCup({
  drinkName,
  delayMs,
}: {
  drinkName: string;
  delayMs: number;
}) {
  const { liquid, liquidLight } = resolveCupVisual({ drinkName, picked: [] });
  return (
    <svg
      viewBox="0 0 20 27"
      className="mbt-star-pop h-[18px] w-auto shrink-0"
      style={delayMs ? { animationDelay: `${delayMs}ms` } : undefined}
      aria-hidden="true"
    >
      {/* Hover on desktop says which drink this was. */}
      <title>{drinkName}</title>
      {/* Body — same near-straight taper as the big preview cup. */}
      <path
        d="M4.6,7.5 L15.4,7.5 L14.3,24.2 Q14.2,25.6 12.8,25.6 L7.2,25.6 Q5.8,25.6 5.7,24.2 Z"
        fill={liquid}
      />
      {/* Meniscus highlight so it reads as a drink, not a swatch. */}
      <ellipse cx="10" cy="8.6" rx="4.6" ry="0.9" fill={liquidLight} opacity="0.9" />
      <path
        d="M4.6,7.5 L15.4,7.5 L14.3,24.2 Q14.2,25.6 12.8,25.6 L7.2,25.6 Q5.8,25.6 5.7,24.2 Z"
        fill="none"
        stroke="rgba(255,255,255,0.55)"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      {/* Flat sealed lid + straw, matching the big cup. */}
      <g transform="rotate(12 12.4 4.6)">
        <rect x="11.4" y="0.4" width="2.1" height="5" rx="1" fill="#F4E4CB" />
      </g>
      <rect
        x="3.4"
        y="4.6"
        width="13.2"
        height="2.1"
        rx="1"
        fill="#F7EFE1"
        stroke="rgba(255,255,255,0.55)"
        strokeWidth="0.8"
      />
    </svg>
  );
}

function Star({
  state,
  fill,
  delayMs,
}: {
  state: "filled" | "next" | "empty";
  fill: string;
  delayMs: number;
}) {
  const cls =
    state === "filled"
      ? "mbt-star-pop"
      : state === "next"
        ? "mbt-star-pulse"
        : "";

  return (
    <svg
      viewBox="0 0 24 24"
      className={"h-[15px] w-[15px] shrink-0 " + cls}
      style={delayMs ? { animationDelay: `${delayMs}ms` } : undefined}
      aria-hidden="true"
    >
      <path
        d="M12 2.6l2.9 5.9 6.5.95-4.7 4.58 1.1 6.47L12 17.44l-5.8 3.06 1.1-6.47-4.7-4.58 6.5-.95z"
        fill={state === "filled" ? fill : "none"}
        stroke={state === "empty" ? "rgba(255,255,255,0.30)" : fill}
        strokeWidth={state === "filled" ? 0 : 1.7}
        strokeLinejoin="round"
      />
    </svg>
  );
}
