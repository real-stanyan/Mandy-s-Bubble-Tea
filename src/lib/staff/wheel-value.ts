// Splitting a counted quantity into the two drums of the picker, and putting
// it back together.
//
// Counts are floats on purpose (herbal jelly 0.3, watermelon 0.5 — see
// stocklist.ts), so the picker is whole-number × tenth, the same shape as an
// alarm's hour × minute. One decimal place is all the sheet has ever used.

export const MAX_WHOLE = 99;

export type WheelParts = { whole: number; tenth: number };

/** Blank stays blank: an uncounted item must not read as a counted zero. */
export function toParts(value: string): WheelParts | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  const clamped = Math.min(n, MAX_WHOLE + 0.9);
  const whole = Math.floor(clamped);
  // Round rather than truncate so a stored 0.25 lands on 0.3 instead of 0.2,
  // and guard the float: 0.29999999 must not become tenth 2.
  const tenth = Math.round((clamped - whole) * 10);
  return tenth === 10 ? { whole: Math.min(whole + 1, MAX_WHOLE), tenth: 0 } : { whole, tenth };
}

/** The string that goes back into the form state. */
export function fromParts(parts: WheelParts): string {
  const whole = Math.max(0, Math.min(Math.round(parts.whole), MAX_WHOLE));
  const tenth = Math.max(0, Math.min(Math.round(parts.tenth), 9));
  // Whole numbers stay whole — "3", not "3.0" — because that is what staff
  // wrote on the paper sheet and what the report reads best as.
  return tenth === 0 ? String(whole) : `${whole}.${tenth}`;
}
