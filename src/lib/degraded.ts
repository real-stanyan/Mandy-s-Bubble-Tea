import * as Sentry from "@sentry/nextjs";

/**
 * Reports a path that kept serving, but on a worse answer than it should have.
 *
 * These are the failures nobody finds out about. Sentry only auto-captures what
 * is THROWN (`instrumentation.ts` wires `captureRequestError`); a fallback we
 * caught and recovered from produces a healthy 200 and a `console.error` nobody
 * reads. Three production crons failed that way for 48 days (#86) before anyone
 * looked at a log — the outage was never invisible, just unaddressed.
 *
 * So: still log, and also raise it as a warning-level Sentry event, which is
 * what actually reaches a human. Warning rather than error on purpose — the
 * request succeeded, and paging on it would train everyone to ignore the page.
 *
 * `event` is a stable slug, not a sentence: it is the Sentry grouping key, so
 * two occurrences of the same degradation must produce the same string. Put the
 * varying part in `detail`.
 */
export function reportDegraded(
  event: string,
  detail: Record<string, unknown> = {},
  cause?: unknown,
): void {
  const causeMessage =
    cause instanceof Error ? cause.message : cause != null ? String(cause) : null;

  console.error(
    `[degraded] ${event}`,
    JSON.stringify(causeMessage ? { ...detail, cause: causeMessage } : detail),
  );

  Sentry.captureMessage(`degraded: ${event}`, {
    level: "warning",
    tags: { degraded: event },
    // SECURITY: callers pass operational facts only (ids, counts, flags).
    // sendDefaultPii is false and nothing here should carry customer data.
    extra: causeMessage ? { ...detail, cause: causeMessage } : detail,
  });
}
