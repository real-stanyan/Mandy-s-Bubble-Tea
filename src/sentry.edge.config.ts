import * as Sentry from "@sentry/nextjs";

// Vercel Edge-runtime Sentry init. Imported by src/instrumentation.ts
// when NEXT_RUNTIME === "edge" (e.g. middleware runs on the edge).
Sentry.init({
  dsn: process.env.SENTRY_DSN,

  sendDefaultPii: true,

  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  enableLogs: true,
});
