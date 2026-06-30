// Classify which client placed a request: the native app or the web site.
//
// Why this exists: the Expo app and the Next.js site both POST to the same
// /api/orders route with the same Square OAuth app, so neither Square's
// order source nor the (previously hard-coded) metadata.source could tell
// them apart. We tag every order's metadata.source from here instead.
//
// Two signals, in priority order:
//   1. An explicit `X-Client-Platform: app|web` header. The app can start
//      sending this after its next release for an unambiguous signal.
//   2. The User-Agent. Browsers always send a Mozilla/AppleWebKit token;
//      the app's fetch does not — iOS native networking reports
//      CFNetwork/Darwin, Android (okhttp) reports okhttp, Expo Go reports
//      Expo. This lets the *current* app be classified with no app release.

export type ClientPlatform = "web" | "app";

export function clientPlatformFrom(
  explicit: string | null | undefined,
  userAgent: string | null | undefined,
): ClientPlatform {
  const e = (explicit ?? "").trim().toLowerCase();
  if (e === "app" || e === "web") return e;

  const ua = (userAgent ?? "").toLowerCase();
  if (!ua) return "web";

  // Android RN networking layer — unambiguous, browsers never send this.
  if (ua.includes("okhttp")) return "app";

  // Real browsers (incl. iOS Safari / Android Chrome) carry these tokens.
  if (ua.includes("mozilla") || ua.includes("applewebkit")) return "web";

  // iOS native fetch + Expo dev client markers (no Mozilla token present).
  if (
    ua.includes("cfnetwork") ||
    ua.includes("darwin") ||
    ua.includes("expo") ||
    ua.includes("mandysbubbletea") ||
    ua.includes("react-native") ||
    ua.includes("reactnative")
  ) {
    return "app";
  }

  // Unknown / non-browser tooling: default to web (the dominant channel)
  // rather than over-attributing to the app.
  return "web";
}
