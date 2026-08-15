import { NextResponse } from "next/server";
import { bearerTokenMatches } from "@/lib/bearer-auth";
import { squareClient } from "@/lib/square";
import { COMPLAINT_TO_EMAIL } from "@/lib/email/resend";
import { sendTransactionalEmail } from "@/lib/email/send";
import {
  assessPaymentHealth,
  decideAlert,
  COUNT_THRESHOLD,
  MIN_ATTEMPTS,
  RATE_THRESHOLD,
  type PaymentSample,
} from "@/lib/alerts/payment-health";
import { readAlertState, writeAlertState } from "@/lib/alerts/payment-health-store";

export const dynamic = "force-dynamic";

const TO = process.env.PAYMENT_ALERT_TO ?? COMPLAINT_TO_EMAIL;
const FROM =
  process.env.STOCK_REPORT_FROM ?? "Mandy's Alerts <noreply@mandybubbletea.com>";

/** How far back each run looks. Wider than the 15-minute schedule on purpose:
 *  a 15-minute window at a quiet hour is three payments and no signal, and a
 *  30-minute one still catches an outage within a run of it starting. */
const LOOKBACK_MS = 30 * 60 * 1000;

/**
 * Asks Square how the last half hour of card payments went, and emails the
 * shop when too many were refused.
 *
 * It reads Square rather than our own logs deliberately. Square is where the
 * answer actually lives: it sees declines from the app and the website alike,
 * it is unaffected by whether our own logging worked, and on the day this was
 * written our code had no idea anything was wrong — every one of those 59
 * declines was, from our side, a payment we correctly handed over and Square
 * correctly refused.
 */
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[cron/payment-health] CRON_SECRET not configured");
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  if (!bearerTokenMatches(request, expected)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const now = new Date();
  const since = new Date(now.getTime() - LOOKBACK_MS).toISOString();

  let samples: PaymentSample[];
  try {
    const res = await squareClient.payments.list({
      beginTime: since,
      sortOrder: "DESC",
      limit: 100,
    });
    const payments = res.data ?? [];
    samples = payments.map((p) => ({ failed: p.status === "FAILED" }));
  } catch (e) {
    // A Square outage is not a payment outage, and guessing in either
    // direction is worse than saying nothing. Report the failure and leave
    // the alert state exactly as it was.
    console.error("[cron/payment-health] could not read payments", e);
    return NextResponse.json({ ok: false, error: "square-unreachable" }, { status: 502 });
  }

  const verdict = assessPaymentHealth(samples);
  const state = await readAlertState();
  const decision = decideAlert(verdict, state, now);

  if (decision.action === "none") {
    return NextResponse.json({ ok: true, verdict, sent: false });
  }

  const pct = (verdict.rate * 100).toFixed(0);
  const window = "last 30 minutes";

  if (decision.action === "recovered") {
    await sendTransactionalEmail("payment-health", {
      from: FROM,
      to: [TO],
      subject: "Payments are back to normal",
      text: [
        `Card payments look healthy again.`,
        ``,
        `Over the ${window}: ${verdict.failures} declined out of ${verdict.attempts} (${pct}%).`,
        ``,
        `If a notice was put on the checkout page during the outage, take it`,
        `down — a stale apology tells customers the shop is still broken.`,
      ].join("\n"),
    });
    await writeAlertState({ alertedAt: null });
    return NextResponse.json({ ok: true, verdict, sent: "recovered" });
  }

  const why =
    verdict.reason === "count"
      ? `${verdict.failures} declines in half an hour (normally at most 2)`
      : `${pct}% of payments declined (normally under 22%)`;

  await sendTransactionalEmail("payment-health", {
    from: FROM,
    to: [TO],
    subject:
      decision.kind === "reminder"
        ? `STILL FAILING: ${verdict.failures}/${verdict.attempts} card payments declined`
        : `Card payments are failing: ${verdict.failures}/${verdict.attempts} declined`,
    text: [
      `${why}.`,
      ``,
      `Over the ${window}: ${verdict.attempts} attempts, ${verdict.failures} declined (${pct}%).`,
      ``,
      `What to check, in this order:`,
      `1. Square Dashboard → Transactions. If the declines are one card brand`,
      `   (this happened to Mastercard on 15 Aug), it is the bank's side and`,
      `   Square support is the only fix. Tell customers which cards work.`,
      `2. If it is every brand, it is more likely ours — check whether`,
      `   anything deployed just before it started.`,
      ``,
      `Thresholds: alert at ${COUNT_THRESHOLD}+ declines, or ${(RATE_THRESHOLD * 100).toFixed(0)}%+`,
      `of at least ${MIN_ATTEMPTS} attempts. Derived from three normal days,`,
      `where the worst half hour had 2 declines.`,
      ``,
      `You will get one more of these in an hour if it is still bad, and one`,
      `when it recovers.`,
    ].join("\n"),
  });
  await writeAlertState({ alertedAt: now.toISOString() });

  return NextResponse.json({ ok: true, verdict, sent: decision.kind });
}
