import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";
import { withSentryConfig } from "@sentry/nextjs";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@napi-rs/canvas",
    "@resvg/resvg-js",
    "passkit-generator",
    "sharp",
  ],
  images: {
    // Next's default optimized-image TTL is 60 seconds, so nearly every
    // visitor pays for a fresh optimize. Measured on production 2026-08-11:
    // a 21KB hero image took 719–1052ms through /_next/image and came back
    // cache=MISS even on an immediate second request, while the raw .webp
    // served in 126ms. One day keeps the cache warm across a whole trading
    // day (1440× fewer re-optimizes) and still lets a replaced product photo
    // heal by itself within 24h — the reason not to set this to a month.
    minimumCacheTTL: 86400,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "items-images-production.s3.us-west-2.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "square-catalog-sandbox.s3.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "items-images-sandbox.s3.us-west-2.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "*.squarecdn.com",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/.well-known/apple-app-site-association",
        headers: [{ key: "Content-Type", value: "application/json" }],
      },
      {
        source: "/.well-known/assetlinks.json",
        headers: [{ key: "Content-Type", value: "application/json" }],
      },
    ];
  },
};

// Sentry wraps the (already analyzer-wrapped) config so it can inject the
// build-time source-map upload step and runtime instrumentation. org/project/
// authToken are read from env (SENTRY_ORG / SENTRY_PROJECT / SENTRY_AUTH_TOKEN)
// so they only need to be set in CI / Vercel — local dev builds skip upload.
export default withSentryConfig(withBundleAnalyzer(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Upload a wider set of client bundles for more readable stack traces.
  widenClientFileUpload: true,

  // Route Sentry requests through this app to dodge ad-blockers. NOTE: the
  // Supabase middleware matcher (src/middleware.ts) currently also runs on
  // this path; it only refreshes the session cookie and passes through, so
  // the tunnel still works.
  tunnelRoute: "/monitoring",

  // Suppress the SDK's build logs unless running in CI.
  silent: !process.env.CI,
});

