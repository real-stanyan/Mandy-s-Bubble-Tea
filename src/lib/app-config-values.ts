// Remote app-config values served by /api/app-config — the native app's
// min-version gate reads this at launch (fail-open on its side). Bump
// `minBuild` to the first build with a WORKING payment flow, not simply the
// latest release. Every shipped build so far — up to and including 1.1.3,
// which is EAS build 23 — carries the tokenize-hang defect that strands
// payments.
//
// Build numbers are EAS-remote-assigned (app repo eas.json
// appVersionSource:"remote" + autoIncrement): the payment-hardening fix is
// EXPECTED to ship as build 24. minBuild/latestBuild stay 23 as placeholders
// until that build is live on the App Store, then set both to the real
// EAS-assigned number. (The app's decideUpdateGate fails open while
// minBuild > latestBuild, so bumping minBuild ahead of the store release
// can't wall users off.)
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
