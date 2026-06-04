import { describe, expect, it } from "vitest";
import {
  decodePolyline,
  shouldRefetchRoute,
  formatEtaMinutes,
  type RouteCache,
} from "./delivery-route";

describe("decodePolyline", () => {
  // Canonical example from Google's polyline algorithm docs.
  it("decodes the Google reference polyline", () => {
    const pts = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(pts).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(decodePolyline("")).toEqual([]);
  });

  it("round-trips a Southport-ish two-point segment with 1e-5 precision", () => {
    // Encoded from (-27.96600, 153.41150) → (-27.97000, 153.40500)
    const pts = decodePolyline("nbuiD{djg\\~Wrg@");
    expect(pts.length).toBe(2);
    expect(pts[0][0]).toBeCloseTo(-27.966, 5);
    expect(pts[0][1]).toBeCloseTo(153.4115, 5);
    expect(pts[1][0]).toBeCloseTo(-27.97, 5);
    expect(pts[1][1]).toBeCloseTo(153.405, 5);
  });
});

describe("shouldRefetchRoute", () => {
  const now = new Date("2026-06-04T05:00:00Z");
  const freshCache: RouteCache = {
    polyline: "abc",
    originLat: -27.966,
    originLng: 153.4115,
    durationSecs: 600,
    fetchedAt: new Date("2026-06-04T04:59:30Z").toISOString(), // 30s old
  };

  it("fetches when there is no cache", () => {
    expect(shouldRefetchRoute(null, { lat: -27.966, lng: 153.4115 }, now)).toBe(true);
  });

  it("keeps a fresh cache when the origin has barely moved", () => {
    // ~50m east of the cached origin
    expect(
      shouldRefetchRoute(freshCache, { lat: -27.966, lng: 153.41201 }, now),
    ).toBe(false);
  });

  it("refetches when the driver moved more than 150m from the cached origin", () => {
    // ~300m east
    expect(
      shouldRefetchRoute(freshCache, { lat: -27.966, lng: 153.41455 }, now),
    ).toBe(true);
  });

  it("refetches when the cache is older than 2 minutes", () => {
    const stale = { ...freshCache, fetchedAt: "2026-06-04T04:57:00Z" }; // 3min old
    expect(
      shouldRefetchRoute(stale, { lat: -27.966, lng: 153.4115 }, now),
    ).toBe(true);
  });

  it("treats a cache row with missing fields as no cache", () => {
    expect(
      shouldRefetchRoute(
        { ...freshCache, polyline: null },
        { lat: -27.966, lng: 153.4115 },
        now,
      ),
    ).toBe(true);
  });
});

describe("formatEtaMinutes", () => {
  it("rounds up to whole minutes with a floor of 1", () => {
    expect(formatEtaMinutes(30)).toBe("~1 min");
    expect(formatEtaMinutes(60)).toBe("~1 min");
    expect(formatEtaMinutes(610)).toBe("~11 min");
    expect(formatEtaMinutes(900)).toBe("~15 min");
  });

  it("returns null for missing or invalid input", () => {
    expect(formatEtaMinutes(null)).toBeNull();
    expect(formatEtaMinutes(0)).toBeNull();
    expect(formatEtaMinutes(-5)).toBeNull();
  });
});
