import * as Sentry from "@sentry/nextjs";

// Node.js server-runtime Sentry init. Imported by src/instrumentation.ts
// when NEXT_RUNTIME === "nodejs".
Sentry.init({
  dsn: process.env.SENTRY_DSN,

  sendDefaultPii: true,

  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // Attach local variables to stack traces for easier debugging of
  // Square / Supabase server errors.
  includeLocalVariables: true,

  enableLogs: true,
});
