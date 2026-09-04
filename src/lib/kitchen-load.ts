// How long until an ASAP pickup is ready, from how busy the kitchen is
// right now. Pure — the counting lives in kitchen-load-server.ts.
//
// The checkout used to promise "~10 min" no matter what. On a quiet
// afternoon that is a lie in the customer's disfavour (they wait outside
// for a drink that's been on the counter for six minutes); at 6pm on a
// Friday it is a lie the other way. Stan's brackets (2026-09-04):
//   quiet   → 2–3 min
//   medium  → 5–7 min
//   busy    → 7–10 min
//
// Busyness is measured in CUPS still to be made, not orders: a 6-cup
// office order is a bigger queue than three singles. Thresholds are the
// one thing to tune if the floor says the estimates run hot or cold.

export type KitchenLevel = "quiet" | "medium" | "busy";

export type KitchenLoad = {
  level: KitchenLevel;
  /** Cups in the make queue when this was measured. */
  pendingCups: number;
  minMinutes: number;
  maxMinutes: number;
  /** "2–3 min" — the customer-facing range. */
  label: string;
};

/** Cups still to be made that separate the brackets. ≤ QUIET_MAX_CUPS is
 *  quiet, ≤ MEDIUM_MAX_CUPS is medium, anything more is busy. */
export const QUIET_MAX_CUPS = 3;
export const MEDIUM_MAX_CUPS = 10;

const RANGES: Record<KitchenLevel, [number, number]> = {
  quiet: [2, 3],
  medium: [5, 7],
  busy: [7, 10],
};

export function kitchenLevelFor(pendingCups: number): KitchenLevel {
  if (pendingCups <= QUIET_MAX_CUPS) return "quiet";
  if (pendingCups <= MEDIUM_MAX_CUPS) return "medium";
  return "busy";
}

export function kitchenLoadFor(pendingCups: number): KitchenLoad {
  const cups = Math.max(0, Math.floor(pendingCups));
  const level = kitchenLevelFor(cups);
  const [minMinutes, maxMinutes] = RANGES[level];
  return {
    level,
    pendingCups: cups,
    minMinutes,
    maxMinutes,
    label: `${minMinutes}–${maxMinutes} min`,
  };
}

/** What the UI shows when the live measurement is unavailable (Square
 *  down, first paint before the poll). The middle bracket: never the
 *  optimistic one, so a customer is early rather than late. */
export const KITCHEN_LOAD_FALLBACK: KitchenLoad = kitchenLoadFor(QUIET_MAX_CUPS + 1);

/** "quiet right now" / "a little busy right now" / "busy right now" —
 *  the honest aside next to the estimate. */
export function kitchenMoodLabel(level: KitchenLevel): string {
  switch (level) {
    case "quiet":
      return "quiet right now";
    case "medium":
      return "a little busy right now";
    case "busy":
      return "busy right now";
  }
}
