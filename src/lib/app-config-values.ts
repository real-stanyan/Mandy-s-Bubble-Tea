// Remote app-config values served by /api/app-config — the native app's
// min-version gate reads this at launch (fail-open on its side). Bump
// `minBuild` to force-update every binary below it; keep it at the last
// build with a KNOWN-BROKEN flow (build ≤22 ships the tokenize hang that
// strands payments), not simply the latest release.
//
// Deliberately a checked-in constant, not a DB row: it changes a few times a
// year, ships with a deploy, and stays reviewable in git history.
export const APP_CONFIG = {
  ios: {
    minBuild: 23,
    latestBuild: 23,
    storeUrl: "https://apps.apple.com/au/app/id6762111842",
  },
  android: null,
} as const;
