"use client";

import { starTrack } from "@/lib/loyalty-stars";
import { resolveCupVisual } from "@/lib/menu/cup-visual";

// The membership card's progress toward a free drink — one pip per star, and
// when we know which cup earned a star, the pip IS that cup: a tiny drink in
// its real colour. Nine drinks you recognise beats nine abstract stars, and
// both beat 78% of a hairline bar.
//
// There are no stars left on this track — every pip is a cup (Stan's call,
// 2026-08-08, over the earlier star fallbacks). Earned pips are filled cups:
// the traced drink's colour when attribution knows it, a house drink picked
// by pip index when it doesn't (index-keyed, never random — Math.random
// re-rolls on every render and diverges between server and client; a
// placeholder also carries no tooltip, so it never claims to be a specific
// order). Unearned pips are the same cup empty, outline only. The emphasis
// is still rationed: only the cup you are about to earn breathes, and only
// within two of a reward — the 2026-08-08 pull found 193 customers there.

type Props = {
  balance: number;
  starsPerReward: number;
  /** Tier accent, used for earned stars so the track matches the card. */
  fill: string;
  /**
   * Drink that earned each star of this cycle, oldest first — index i maps
   * to filled pip i. A null ENTRY draws a house-drink placeholder cup; an
   * entirely absent array (attribution not loaded / failed) keeps stars.
   */
  drinks?: Array<string | null> | null;
};

/**
 * House drinks a placeholder cup borrows its colour from — varied hues so a
 * row of untraceable stars still reads as a row of different drinks. Indexed
 * by pip, never random: random re-rolls every render and diverges between
 * server and client.
 */
const PLACEHOLDER_DRINKS = [
  "Brown Sugar Milk Tea",
  "Taro Milk Tea",
  "Matcha Milk Tea",
  "Mango Slushy",
  "Strawberry Iced Green Tea",
  "Lychee Iced Green Tea",
  "Chocolate Milk Tea",
  "Peach Iced Green Tea",
  "Passion Fruit Iced Green Tea",
  "Grapefruit Iced Green Tea",
  "Blueberry Iced Green Tea",
  "Coconut Milk Tea",
] as const;

export function StarTrack({ balance, starsPerReward, fill, drinks }: Props) {
  const track = starTrack(balance, starsPerReward);

  return (
    <div className="mt-3">
      <div
        className={
          "flex items-end gap-[4px] rounded-full " +
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
          if (state === "filled") {
            const attributed = drinks?.[i] ?? null;
            return (
              <MiniCup
                key={i}
                drinkName={
                  attributed ??
                  PLACEHOLDER_DRINKS[i % PLACEHOLDER_DRINKS.length]
                }
                // A placeholder never claims to be a specific order.
                placeholder={attributed == null}
                // Earned cups land left to right on first paint.
                delayMs={i * 55}
              />
            );
          }
          // Unearned pips are empty cups, not star outlines — the whole
          // track speaks one language (Stan, 2026-08-08). The next one to
          // earn breathes in the tier accent.
          return <OutlineCup key={i} accent={fill} pulse={state === "next"} />;
        })}
      </div>

      {track.nudge && (
        <p
          className="mt-2 text-[12.5px] font-semibold leading-none"
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
  placeholder,
  delayMs,
}: {
  drinkName: string;
  /** Borrowed house colour, not this customer's traced order — no tooltip. */
  placeholder: boolean;
  delayMs: number;
}) {
  const { liquid, liquidLight } = resolveCupVisual({ drinkName, picked: [] });
  return (
    <svg
      viewBox="0 0 20 27"
      className="mbt-star-pop h-[24px] w-auto shrink-0"
      style={delayMs ? { animationDelay: `${delayMs}ms` } : undefined}
      aria-hidden="true"
    >
      {/* Hover on desktop says which drink this was — only when we know. */}
      {!placeholder && <title>{drinkName}</title>}
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

/**
 * An unearned pip: the same cup, empty — outline only, no liquid, no straw.
 * The next one to earn breathes in the tier accent; the rest stay quiet in
 * faint white.
 */
function OutlineCup({ accent, pulse }: { accent: string; pulse: boolean }) {
  const stroke = pulse ? accent : "rgba(255,255,255,0.30)";
  return (
    <svg
      viewBox="0 0 20 27"
      className={"h-[24px] w-auto shrink-0 " + (pulse ? "mbt-star-pulse" : "")}
      aria-hidden="true"
    >
      <path
        d="M4.6,7.5 L15.4,7.5 L14.3,24.2 Q14.2,25.6 12.8,25.6 L7.2,25.6 Q5.8,25.6 5.7,24.2 Z"
        fill="none"
        stroke={stroke}
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <rect
        x="3.4"
        y="4.6"
        width="13.2"
        height="2.1"
        rx="1"
        fill="none"
        stroke={stroke}
        strokeWidth="1.1"
      />
    </svg>
  );
}
