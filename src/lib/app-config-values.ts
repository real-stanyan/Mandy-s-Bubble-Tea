// Remote app-config values served by /api/app-config — the native app's
// min-version gate reads this at launch (fail-open on its side).
//
// FORCE-UPDATE POLICY (Stan, 2026-07-07): EVERY App release is mandatory.
// Any user on a build older than the one live on the store gets the
// full-screen update wall. So `minBuild` is ALWAYS pinned to `latestBuild`
// (the live store build) via the single constant below — there is exactly
// ONE number to change per release, and the two can never silently drift.
//
// WHEN TO BUMP: set the *_LIVE_BUILD constant to the new build number ONLY
// AFTER that build is actually live/approved on the App Store — never before.
// Because minBuild is kept equal to latestBuild, bumping ahead of Apple
// approval would wall users on the current build with nothing to download
// (the old minBuild>latestBuild fail-open no longer protects you once the two
// are equal). Build numbers are EAS-remote-assigned / Xcode CFBundleVersion;
// use the exact number the store listing shows.
//
// Deliberately a checked-in constant, not a DB row: it changes a few times a
// year, ships with a deploy, and stays reviewable in git history.

/**
 * The iOS build currently live on the App Store. Bump on EVERY release, once
 * it is live. `minBuild` is pinned to this so every older build is
 * force-updated (see FORCE-UPDATE POLICY above).
 */
const IOS_LIVE_BUILD = 23;

export const APP_CONFIG = {
  ios: {
    minBuild: IOS_LIVE_BUILD,
    latestBuild: IOS_LIVE_BUILD,
    storeUrl: "https://apps.apple.com/au/app/id6762111842",
  },
  // Android has no store listing yet (sideloaded APK / EAS preview build), so
  // there is no actionable update target — leave null and the gate fails open
  // for Android. When Mandy's ships to Play Store, mirror the iOS block with
  // an ANDROID_LIVE_BUILD constant + the Play Store URL so the same
  // mandatory-every-release policy applies to Android.
  android: null,
} as const;
