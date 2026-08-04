import { describe, it, expect } from "vitest";
import {
  LOCK_MS,
  MAX_FAILURES,
  WINDOW_MS,
  lockRemainingMinutes,
  lockRemainingMs,
  nextStateAfterFailure,
  type AttemptRow,
} from "./login-throttle";

const NOW = Date.parse("2026-08-04T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

describe("lockRemainingMs", () => {
  it("is zero for an IP with no history and for an unlocked row", () => {
    expect(lockRemainingMs(null, NOW)).toBe(0);
    expect(
      lockRemainingMs({ failures: 2, windowStartedAt: iso(NOW), lockedUntil: null }, NOW),
    ).toBe(0);
  });

  it("is zero once the lock has passed, not negative", () => {
    const row: AttemptRow = {
      failures: MAX_FAILURES,
      windowStartedAt: iso(NOW - LOCK_MS),
      lockedUntil: iso(NOW - 1),
    };
    expect(lockRemainingMs(row, NOW)).toBe(0);
  });

  it("rounds the displayed wait up, and never to zero while still locked", () => {
    const row: AttemptRow = {
      failures: MAX_FAILURES,
      windowStartedAt: iso(NOW),
      lockedUntil: iso(NOW + 1000),
    };
    // One second left still has to read as "a minute", not "0 minutes".
    expect(lockRemainingMinutes(row, NOW)).toBe(1);
    expect(lockRemainingMinutes({ ...row, lockedUntil: iso(NOW + 61_000) }, NOW)).toBe(2);
  });
});

describe("nextStateAfterFailure", () => {
  it("starts a fresh window for an unknown IP", () => {
    const next = nextStateAfterFailure(null, NOW);
    expect(next.failures).toBe(1);
    expect(next.windowStartedAt).toBe(iso(NOW));
    expect(next.lockedUntil).toBeNull();
  });

  it("counts up inside the window without moving its start", () => {
    const started = iso(NOW - 60_000);
    const next = nextStateAfterFailure(
      { failures: 2, windowStartedAt: started, lockedUntil: null },
      NOW,
    );
    expect(next.failures).toBe(3);
    expect(next.windowStartedAt).toBe(started);
    expect(next.lockedUntil).toBeNull();
  });

  it("locks exactly on the budget being spent", () => {
    const next = nextStateAfterFailure(
      {
        failures: MAX_FAILURES - 1,
        windowStartedAt: iso(NOW - 60_000),
        lockedUntil: null,
      },
      NOW,
    );
    expect(next.failures).toBe(MAX_FAILURES);
    expect(next.lockedUntil).toBe(iso(NOW + LOCK_MS));
  });

  it("forgets a stale window instead of resuming its count", () => {
    // Someone who mistypes once a month must never accumulate a lockout.
    const next = nextStateAfterFailure(
      {
        failures: MAX_FAILURES - 1,
        windowStartedAt: iso(NOW - WINDOW_MS - 1),
        lockedUntil: null,
      },
      NOW,
    );
    expect(next.failures).toBe(1);
    expect(next.lockedUntil).toBeNull();
  });

  it("starts clean after a served lock rather than re-locking on the next try", () => {
    // The IP already paid for those failures; charging them again would turn a
    // 15-minute lock into a permanent one.
    const next = nextStateAfterFailure(
      {
        failures: MAX_FAILURES,
        windowStartedAt: iso(NOW - LOCK_MS - 1000),
        lockedUntil: iso(NOW - 1000),
      },
      NOW,
    );
    expect(next.failures).toBe(1);
    expect(next.lockedUntil).toBeNull();
  });

  it("caps a scripted guesser well below what a short passcode needs", () => {
    // Walk an hour of continuous guessing and count how many reach checkPasscode.
    let row: AttemptRow | null = null;
    let attempts = 0;
    for (let t = NOW; t < NOW + 60 * 60 * 1000; t += 1000) {
      if (lockRemainingMs(row, t) > 0) continue;
      attempts++;
      row = nextStateAfterFailure(row, t);
    }
    expect(attempts).toBeLessThanOrEqual(20);
  });
});
