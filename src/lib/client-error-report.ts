// Fire-and-forget client-side error reporter. Sends payment/checkout
// failures (especially Square SDK tokenize/verifyBuyer errors, which are
// invisible server-side) to /api/client-log so they surface in Vercel
// runtime logs. Never throws, never blocks the UI.

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
  try {
    const body = JSON.stringify({
      ...payload,
      ts: new Date().toISOString(),
      ua: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      url: typeof location !== "undefined" ? location.pathname : undefined,
    });
    // keepalive lets the request survive a navigation/unmount.
    void fetch("/api/client-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // never throw from the reporter
  }
}
