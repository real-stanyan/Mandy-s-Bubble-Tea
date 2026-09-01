import { describe, it, expect } from "vitest";
import { coordsAreValid, distanceKm, interpretPlacesStatus, STORE_COORDS } from "./places";

describe("interpretPlacesStatus", () => {
  it("treats OK and ZERO_RESULTS as a working service", () => {
    expect(interpretPlacesStatus("OK")).toBe("ready");
    // Google answered, it just had no match for the typed text.
    expect(interpretPlacesStatus("ZERO_RESULTS")).toBe("ready");
  });

  it("treats a denied key as down — the 2026-09-01 billing outage", () => {
    expect(interpretPlacesStatus("REQUEST_DENIED")).toBe("down");
  });

  it("treats quota, unknown errors and no answer as down", () => {
    expect(interpretPlacesStatus("OVER_QUERY_LIMIT")).toBe("down");
    expect(interpretPlacesStatus("UNKNOWN_ERROR")).toBe("down");
    expect(interpretPlacesStatus("INVALID_REQUEST")).toBe("down");
    expect(interpretPlacesStatus(null)).toBe("down");
    expect(interpretPlacesStatus(undefined)).toBe("down");
  });
});

describe("coordsAreValid", () => {
  it("rejects the 0/0 sentinel and non-finite values", () => {
    expect(coordsAreValid(0, 0)).toBe(false);
    expect(coordsAreValid(-27.97, 0)).toBe(false);
    expect(coordsAreValid(Number.NaN, 153.4)).toBe(false);
  });

  it("accepts a real Southport coordinate", () => {
    expect(coordsAreValid(-27.97, 153.41)).toBe(true);
  });
});

describe("distanceKm", () => {
  it("is zero at the store itself", () => {
    expect(distanceKm(STORE_COORDS, STORE_COORDS)).toBeCloseTo(0, 6);
  });
});
