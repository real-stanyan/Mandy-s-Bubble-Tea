// Brute-force policy for the staff login, kept free of I/O so the arithmetic
// that decides "locked or not" can be tested without a database.
//
// The shape is deliberately boring: count failures inside a rolling window,
// lock the IP for a while once the budget is spent, forget everything on a
// successful login.

export type AttemptRow = {
  failures: number;
  windowStartedAt: string;
  lockedUntil: string | null;
};

/**
 * Five tries buys a staff member who mistyped a shared code several attempts,
 * while capping a scripted guesser at 20 per hour per IP. Against the 17,576
 * combinations of a three-letter code that is centuries instead of seconds —
 * but it is a floor, not a substitute for a long passcode.
 */
export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60 * 1000;
export const LOCK_MS = 15 * 60 * 1000;

/** Milliseconds left on the lock, or 0 when the IP may try again. */
export function lockRemainingMs(row: AttemptRow | null, now: number): number {
  if (!row?.lockedUntil) return 0;
  const until = Date.parse(row.lockedUntil);
  if (!Number.isFinite(until)) return 0;
  return Math.max(0, until - now);
}

/** Whole minutes to show the user; always at least 1 while still locked. */
export function lockRemainingMinutes(row: AttemptRow | null, now: number): number {
  const ms = lockRemainingMs(row, now);
  return ms === 0 ? 0 : Math.max(1, Math.ceil(ms / 60_000));
}

/**
 * The row to store after a failed attempt.
 *
 * An expired window — or an expired lock — starts counting again from one
 * rather than resuming an old total, so someone who mistypes once a month
 * never accumulates their way into a lockout.
 */
export function nextStateAfterFailure(
  row: AttemptRow | null,
  now: number,
): AttemptRow {
  const windowStarted = row ? Date.parse(row.windowStartedAt) : NaN;
  // Carry the running count only while the window is still open and no lock
  // has been served in it. A served-and-expired lock ends the window: the IP
  // has already paid for those failures and starts clean.
  const carry =
    row != null &&
    row.lockedUntil === null &&
    Number.isFinite(windowStarted) &&
    now - windowStarted < WINDOW_MS;

  const failures = carry ? row!.failures + 1 : 1;
  const windowStartedAt = carry ? row!.windowStartedAt : new Date(now).toISOString();
  const lockedUntil =
    failures >= MAX_FAILURES ? new Date(now + LOCK_MS).toISOString() : null;

  return { failures, windowStartedAt, lockedUntil };
}
