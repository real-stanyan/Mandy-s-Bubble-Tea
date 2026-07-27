import { describe, it, expect } from "vitest";

import {
  hasAppDownloadGrant,
  type AppDownloadStatus,
} from "./use-app-download-status";

const status = (over: Partial<AppDownloadStatus> = {}): AppDownloadStatus => ({
  available: false,
  percentage: 0,
  claimedAt: null,
  redeemedAt: null,
  loading: false,
  ...over,
});

describe("hasAppDownloadGrant", () => {
  it("is false for a phone that never claimed", () => {
    expect(hasAppDownloadGrant(status())).toBe(false);
  });

  it("is true while the ticket is claimed and unspent", () => {
    expect(
      hasAppDownloadGrant(
        status({
          available: true,
          percentage: 20,
          claimedAt: "2026-07-27T00:00:00Z",
        }),
      ),
    ).toBe(true);
  });

  // The whole reason this helper exists. `available` flips back to false at
  // burn, so reading it alone would tell the campaign popup that someone who
  // already spent their 20% never claimed it — and re-offer it forever.
  it("stays true after the ticket is redeemed, when available is false again", () => {
    const redeemed = status({
      available: false,
      percentage: 20,
      claimedAt: "2026-07-27T00:00:00Z",
      redeemedAt: "2026-07-27T01:00:00Z",
    });
    expect(redeemed.available).toBe(false);
    expect(hasAppDownloadGrant(redeemed)).toBe(true);
  });

  it("is false while the check is still in flight, so nothing shows early", () => {
    expect(hasAppDownloadGrant(status({ loading: true }))).toBe(false);
  });
});
