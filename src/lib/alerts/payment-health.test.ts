import { describe, it, expect } from "vitest";
import {
  assessPaymentHealth,
  decideAlert,
  REMIND_AFTER_MS,
  type PaymentSample,
} from "./payment-health";

const w = (attempts: number, failures: number): PaymentSample[] =>
  Array.from({ length: attempts }, (_, i) => ({ failed: i < failures }));

/**
 * The numbers in these tests are the shop's own, measured over 2026-08-12 to
 * 08-14 (1,200 payments) and the outage on the 15th. They are the argument
 * for the thresholds, so they are asserted rather than described.
 */
describe("when payments are worth waking someone for", () => {
  it("stays quiet through the worst normal half hour", () => {
    // The busiest normal window was 14 payments; the most declines in any
    // window across three days was 2.
    expect(assessPaymentHealth(w(14, 2)).alarming).toBe(false);
    expect(assessPaymentHealth(w(9, 2)).alarming).toBe(false);
  });

  it("stays quiet when a tiny window looks bad", () => {
    // Two out of three is 67% and means nothing at 6am. This is the rule
    // that stops the alarm being muted by week two.
    expect(assessPaymentHealth(w(3, 2)).alarming).toBe(false);
    expect(assessPaymentHealth(w(5, 2)).alarming).toBe(false);
  });

  it("fires on the hour the outage started", () => {
    // 04:00 UTC on 15 Aug ran 18 through and 55 declined — 75%.
    const v = assessPaymentHealth(w(20, 15));
    expect(v.alarming).toBe(true);
    expect(v.reason).toBe("count");
  });

  it("fires on a bad rate even when the count is modest", () => {
    const v = assessPaymentHealth(w(10, 4));
    expect(v.alarming).toBe(true);
    expect(v.reason).toBe("rate");
  });

  it("fires on volume even when the rate looks survivable", () => {
    // 25% of 20 is under the rate rule and is still five people who could
    // not pay for their drink.
    const v = assessPaymentHealth(w(20, 5));
    expect(v.alarming).toBe(true);
    expect(v.reason).toBe("count");
  });

  it("reports 0% rather than NaN for an empty window", () => {
    const v = assessPaymentHealth([]);
    expect(v.rate).toBe(0);
    expect(v.alarming).toBe(false);
  });
});

describe("how often it is allowed to speak", () => {
  const bad = assessPaymentHealth(w(20, 15));
  const good = assessPaymentHealth(w(20, 1));
  const t0 = new Date("2026-08-15T04:00:00Z");

  it("alerts the first time it sees trouble", () => {
    expect(decideAlert(bad, { alertedAt: null }, t0)).toEqual({
      action: "alert",
      kind: "new",
    });
  });

  it("says nothing on the next run if it is still bad", () => {
    // Four runs an hour for six hours would be 24 emails about one outage,
    // and the 24th would not be read.
    const justAlerted = { alertedAt: t0.toISOString() };
    const fifteenLater = new Date(t0.getTime() + 15 * 60 * 1000);
    expect(decideAlert(bad, justAlerted, fifteenLater).action).toBe("none");
  });

  it("nudges again after an hour of the same trouble", () => {
    const state = { alertedAt: t0.toISOString() };
    const later = new Date(t0.getTime() + REMIND_AFTER_MS);
    expect(decideAlert(bad, state, later)).toEqual({
      action: "alert",
      kind: "reminder",
    });
  });

  it("says when it is over", () => {
    // Without this the only way to learn it recovered is to go and look,
    // which is the habit the alert exists to replace.
    const state = { alertedAt: t0.toISOString() };
    expect(decideAlert(good, state, t0).action).toBe("recovered");
  });

  it("stays silent when nothing was ever wrong", () => {
    expect(decideAlert(good, { alertedAt: null }, t0).action).toBe("none");
  });

  it("treats unreadable state as never-alerted", () => {
    // Erring toward one email too many beats going quiet through an outage.
    expect(decideAlert(bad, { alertedAt: "not a date" }, t0).action).toBe("none");
    const stale = { alertedAt: "1999-01-01T00:00:00Z" };
    expect(decideAlert(bad, stale, t0)).toEqual({ action: "alert", kind: "reminder" });
  });
});
