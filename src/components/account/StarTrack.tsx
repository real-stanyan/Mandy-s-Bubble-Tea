"use client";

import { starTrack } from "@/lib/loyalty-stars";

// The membership card's progress toward a free drink, as stars rather than a
// hairline bar. Nine pips is a thing you can count at a glance and feel one
// short of; 78% of a bar is not.
//
// The emphasis is deliberately rationed. Only the star you are about to earn
// pulses, and only within two of a reward — the 2026-08-08 pull found 193
// customers sitting there. Everything else stays still, which is what makes
// the pulse mean anything.

type Props = {
  balance: number;
  starsPerReward: number;
  /** Tier accent, used for earned stars so the track matches the card. */
  fill: string;
};

export function StarTrack({ balance, starsPerReward, fill }: Props) {
  const track = starTrack(balance, starsPerReward);

  return (
    <div className="mt-3">
      <div
        className={
          "flex items-center gap-[3px] rounded-full " +
          (track.rewardReady ? "mbt-star-shimmer" : "")
        }
        role="img"
        aria-label={
          track.rewardReady
            ? `${starsPerReward} of ${starsPerReward} stars — free drink ready`
            : `${starsPerReward - track.remaining} of ${starsPerReward} stars`
        }
      >
        {track.states.map((state, i) => (
          <Star
            key={i}
            state={state}
            fill={fill}
            // Earned stars land left to right on first paint. Empty ones have
            // nothing to announce, so they just appear.
            delayMs={state === "filled" ? i * 55 : 0}
          />
        ))}
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
