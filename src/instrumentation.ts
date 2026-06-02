import * as Sentry from "@sentry/nextjs";

// Server-startup instrumentation hook (Next.js `instrumentation` convention).
// register() runs once per server instance; dispatch the Sentry config by
// runtime so edge-incompatible Node APIs are never imported on the edge.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Capture errors thrown in nested React Server Components / route handlers.
export const onRequestError = Sentry.captureRequestError;
