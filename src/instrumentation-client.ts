import * as Sentry from "@sentry/nextjs";

// Browser-side Sentry init. Runs after the HTML loads but before React
// hydration (Next.js `instrumentation-client` convention, v15.3+).
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // SECURITY: false so the browser SDK doesn't attach the user's IP / request
  // headers. Session Replay already masks all text + blocks media below.
  sendDefaultPii: false,

  // Performance tracing — sample 10% in prod to stay within quota
  // (~5k orders/mo), full sampling locally for debugging.
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // Session Replay — 10% of all sessions, 100% of sessions with an error.
  // replayIntegration() masks all text and blocks media by default, so
  // customer PII (phone, name, card fields) is not captured.
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  enableLogs: true,

  integrations: [Sentry.replayIntegration()],
});

// Capture client-side navigation timing for App Router transitions.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
