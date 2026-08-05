// Building a counted quantity by tapping digits.
//
// Replaces the two-drum picker. The drum was the right instinct — no OS
// keyboard sliding over the list — but the wrong motion for the numbers
// actually being entered. Counts here are nearly always a single digit
// (thresholds are mostly 1, and a shelf holds a handful), yet reaching 24 on a
// 0-99 drum meant spinning past twenty-three other numbers, sixty-three times
// a count.
//
// A keypad is one tap for the common case and three for "0.5", and still keeps
// the OS keyboard off the screen.
//
// Counts are floats on purpose (herbal jelly 0.3, watermelon 0.5 — see
// stocklist.ts) but never more than one decimal place, which is all the report
// has ever shown.

export const MAX_WHOLE_DIGITS = 2; // 0-99, as before
export const MAX_DECIMALS = 1;

function split(value: string): { whole: string; frac: string | null } {
  const i = value.indexOf(".");
  if (i === -1) return { whole: value, frac: null };
  return { whole: value.slice(0, i), frac: value.slice(i + 1) };
}

/**
 * Append a digit. Returns the value unchanged when it would overflow, so a
 * stray extra tap is a no-op rather than a silent truncation of what was
 * already entered.
 */
export function pressDigit(value: string, digit: string): string {
  if (!/^[0-9]$/.test(digit)) return value;
  const { whole, frac } = split(value);

  if (frac !== null) {
    if (frac.length >= MAX_DECIMALS) return value;
    return `${whole}.${frac}${digit}`;
  }

  // A leading zero is a placeholder, not a digit: tapping 5 first should give
  // "5", never "05".
  if (whole === "0") return digit;
  if (whole.length >= MAX_WHOLE_DIGITS) return value;
  return whole + digit;
}

/** Start the decimal part. `.3` is entered as a bare dot and reads as 0.3. */
export function pressDot(value: string): string {
  if (value.includes(".")) return value;
  return value === "" ? "0." : `${value}.`;
}

export function pressBackspace(value: string): string {
  return value.slice(0, -1);
}

/**
 * What actually gets stored when the sheet closes.
 *
 * Blank stays blank — an uncounted item must never read as a counted zero,
 * which is the distinction the whole report rests on. A dangling dot ("3.")
 * is just an unfinished tap and means three.
 */
export function normalise(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === ".") return "";
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return "";
  const clamped = Math.min(n, 99.9);
  // Whole numbers stay whole — "3", not "3.0" — because that is what staff
  // wrote on the paper sheet and what the report reads best as.
  return Number.isInteger(clamped) ? String(clamped) : String(Number(clamped.toFixed(1)));
}

/** What the sheet shows while typing. A bare "" reads as a dash, not a zero. */
export function displayValue(value: string): string {
  return value === "" ? "—" : value;
}

/**
 * The entry as the sheet holds it: what's been tapped, plus whether the next
 * digit replaces it.
 *
 * `fresh` is true on a newly-shown item so the first tap overwrites the
 * existing count — walking back to fix a 3 and tapping 5 should give 5, not
 * 35. It has to travel with the entry: when the two were separate pieces of
 * React state, two taps in one batch both read fresh=true and "24" collapsed
 * to "4".
 */
export type Entry = { entry: string; fresh: boolean };

export function applyDigit(state: Entry, digit: string): Entry {
  return { entry: pressDigit(state.fresh ? "" : state.entry, digit), fresh: false };
}

export function applyEdit(state: Entry, fn: (v: string) => string): Entry {
  return { entry: fn(state.entry), fresh: false };
}
