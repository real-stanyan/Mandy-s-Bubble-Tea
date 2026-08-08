// How the membership card's star track should read, given a balance.
//
// Split out of the card so the states can be pinned in tests: the interesting
// one is "almost there", and it is the whole reason this exists. The 2026-08-08
// sales pull found 193 customers sitting on 7–8 of the 9 stars a free drink
// costs — a segment that is one visit from a reward and is currently told so
// only by a number and a hairline bar.

export type StarState =
  /** Earned this cycle. */
  | "filled"
  /** The next one to earn, and close enough that saying so is worth it. */
  | "next"
  /** Not earned, no emphasis. */
  | "empty";

/** Stars remaining at or below this get the pulsing "next" treatment. */
export const NUDGE_THRESHOLD = 2;

export type StarTrack = {
  states: StarState[];
  /** Stars still needed for the next free drink. 0 when one is already banked. */
  remaining: number;
  /** At least one free drink is available right now. */
  rewardReady: boolean;
  /** Short line under the track, or null when there is nothing worth saying. */
  nudge: string | null;
};

export function starTrack(balance: number, starsPerReward: number): StarTrack {
  const goal = starsPerReward > 0 ? starsPerReward : 1;
  const safeBalance = Number.isFinite(balance) && balance > 0 ? Math.floor(balance) : 0;

  // Mirrors the card's existing arithmetic: the track shows progress through
  // the CURRENT cycle, and a banked reward is a separate fact from it.
  const current = Math.min(safeBalance % goal, goal);
  const rewardReady = safeBalance >= goal;
  const remaining = goal - current;

  // A ready reward is the headline; do not also nag about the next cycle.
  const nudging = !rewardReady && remaining <= NUDGE_THRESHOLD && remaining > 0;

  const states: StarState[] = Array.from({ length: goal }, (_, i) => {
    if (i < current) return "filled";
    if (i === current && nudging) return "next";
    return "empty";
  });

  return {
    states,
    remaining: rewardReady ? 0 : remaining,
    rewardReady,
    nudge: rewardReady
      ? "Free drink ready — redeem at checkout"
      : nudging
        ? remaining === 1
          ? "1 more cup and your next drink is on us"
          : `${remaining} more cups and your next drink is on us`
        : null,
  };
}
