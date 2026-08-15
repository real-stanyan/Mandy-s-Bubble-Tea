// Watches how many card payments Square is refusing, and says when that stops
// looking like ordinary bad luck.
//
// Written the day a Mastercard outage ran for hours before anyone told us —
// 59 declines across 21 customers, and we found out because people complained
// in the shop. Nothing in the system noticed, because nothing was watching.
//
// The thresholds are not guesses. Over the three normal days before the
// incident (2026-08-12 to 08-14, 1,200 payments), 15-minute windows looked
// like this:
//
//   median 5 payments per window, 90th percentile 10, busiest 14
//   the most failures in any single window: 2
//   only 9% of windows had a failure at all
//   among windows with 8+ payments, the worst failure rate was 22%
//
// So the rule below fires zero times across those three days, and would have
// fired inside one window of the incident starting (that hour ran at 75%).
// A rule that cries wolf gets muted, and a muted alarm is worse than none.

export type PaymentSample = { failed: boolean };

export type HealthVerdict = {
  attempts: number;
  failures: number;
  /** 0–1. Zero attempts reports 0 rather than NaN. */
  rate: number;
  /** True when this window is bad enough to wake someone up. */
  alarming: boolean;
  /** Which rule tripped — goes in the email so the reason is legible. */
  reason: "rate" | "count" | null;
};

/** Below this many payments a window is too small to mean anything: two
 *  declines out of three is a rate of 67% and a Tuesday morning. */
export const MIN_ATTEMPTS = 6;

/** Normal windows topped out at 22%. 40% leaves room for a genuinely unlucky
 *  stretch without leaving room for an outage. */
export const RATE_THRESHOLD = 0.4;

/** An absolute floor, for a busy window where a bad rate hides in volume:
 *  20 attempts with 5 failures is 25%, under the rate rule, and still five
 *  customers who could not pay. Normal windows never reached 3. */
export const COUNT_THRESHOLD = 5;

export function assessPaymentHealth(samples: PaymentSample[]): HealthVerdict {
  const attempts = samples.length;
  const failures = samples.filter((s) => s.failed).length;
  const rate = attempts === 0 ? 0 : failures / attempts;

  if (failures >= COUNT_THRESHOLD) {
    return { attempts, failures, rate, alarming: true, reason: "count" };
  }
  if (attempts >= MIN_ATTEMPTS && rate >= RATE_THRESHOLD) {
    return { attempts, failures, rate, alarming: true, reason: "rate" };
  }
  return { attempts, failures, rate, alarming: false, reason: null };
}

/** What the watcher remembers between runs, so a running outage does not
 *  send an email every fifteen minutes for six hours. */
export type AlertState = {
  /** ISO time of the last alert sent, or null when all is well. */
  alertedAt: string | null;
};

export type AlertDecision =
  | { action: "alert"; kind: "new" | "reminder" }
  | { action: "recovered" }
  | { action: "none" };

/** How long a known-bad state stays quiet before nudging again. Long enough
 *  not to be noise, short enough that an outage nobody acted on resurfaces
 *  before the day is over. */
export const REMIND_AFTER_MS = 60 * 60 * 1000;

export function decideAlert(
  verdict: HealthVerdict,
  state: AlertState,
  now: Date,
): AlertDecision {
  if (verdict.alarming) {
    if (!state.alertedAt) return { action: "alert", kind: "new" };
    const since = now.getTime() - Date.parse(state.alertedAt);
    if (Number.isFinite(since) && since >= REMIND_AFTER_MS) {
      return { action: "alert", kind: "reminder" };
    }
    return { action: "none" };
  }
  // Recovery is worth an email of its own: without one, the only way to know
  // it is over is to go and look, which is the habit this exists to replace.
  if (state.alertedAt) return { action: "recovered" };
  return { action: "none" };
}
