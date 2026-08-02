// Fire-and-forget client-side error reporter. Sends payment/checkout
// failures (especially Square SDK tokenize/verifyBuyer errors, which are
// invisible server-side) to /api/client-log so they surface in Vercel
// runtime logs, AND to Sentry as a warning so they become observable
// there too. Never throws, never blocks the UI.
//
// Why the Sentry call is here (not just /api/client-log): Sentry only
// auto-captures *unhandled* exceptions, but payment failures are caught
// in `try/catch` so the UI can show a Retry dialog — which means they
// were silently invisible to Sentry (#103: an Apple Pay "network error"
// produced zero Sentry events even though the customer saw a failure).
// Mirrors the server-side pattern in `degraded.ts`: a caught-and-handled
// failure must still be reported as a warning, or no one ever sees it.

import * as Sentry from "@sentry/nextjs";

type ReportPayload = {
  scope: string; // e.g. "checkout" | "cart-drawer"
  step: string; // where in the flow it failed
  message: string;
  meta?: Record<string, unknown>;
};

/** Pull whatever useful fields exist off an unknown thrown value. */
export function describeError(err: unknown): {
  message: string;
  name?: string;
  squareErrors?: unknown;
} {
  if (err && typeof err === "object") {
    const e = err as {
      message?: unknown;
      name?: unknown;
      errors?: unknown;
    };
    return {
      message:
        typeof e.message === "string" ? e.message : String(err),
      name: typeof e.name === "string" ? e.name : undefined,
      // Square SDK errors carry an `errors` array with { code, detail }.
      squareErrors: e.errors,
    };
  }
  return { message: String(err) };
}

export function reportClientError(payload: ReportPayload): void {
  // 1. /api/client-log → Vercel runtime logs (existing behavior). keepalive
  //    lets the request survive a navigation/unmount.
  try {
    const body = JSON.stringify({
      ...payload,
      ts: new Date().toISOString(),
      ua: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      url: typeof location !== "undefined" ? location.pathname : undefined,
    });
    void fetch("/api/client-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // never throw from the reporter
  }

  // 2. Sentry as a warning. Warning (not error): the request may have
  //    recovered, and we don't want to inflate error volumes / alerting
  //    on caught-and-handled failures. The gap this closes (#103): a
  //    caught payment failure produced ZERO Sentry events, so a customer's
  //    Apple Pay "network error" was completely invisible to us. A warning
  //    event is still queryable + attached to the session, so next time
  //    we can read it (and pair it with replay if the session also had
  //    an error-level event).
  //    SECURITY: callers pass operational facts only (method, ids, flags);
  //    sendDefaultPii is false and meta must never carry card data.
  try {
    Sentry.captureMessage(`client-error: ${payload.scope}/${payload.step}`, {
      level: "warning",
      tags: { scope: payload.scope, step: payload.step },
      extra: { message: payload.message, ...payload.meta },
    });
  } catch {
    // Sentry down / SDK not loaded — never throw from the reporter
  }
}
