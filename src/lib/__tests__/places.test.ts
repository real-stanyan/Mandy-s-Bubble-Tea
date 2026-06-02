import { describe, it, expect } from "vitest";
import { coordsAreValid, distanceKm, isWithinDeliveryRadius } from "../places";

const STORE = { lat: -28.0084, lng: 153.4116 }; // 34 Davenport St

describe("distanceKm", () => {
  it("returns 0 for identical points", () => {
    expect(distanceKm(STORE, STORE)).toBeCloseTo(0, 3);
  });

  it("returns ~1 km for ~1 km offset (0.009 deg lat ≈ 1 km)", () => {
    const d = distanceKm(STORE, { lat: STORE.lat + 0.009, lng: STORE.lng });
    expect(d).toBeGreaterThan(0.9);
    expect(d).toBeLessThan(1.1);
  });

  it("returns ~10 km for known 10 km offset (0.09 deg lat)", () => {
    const d = distanceKm(STORE, { lat: STORE.lat + 0.09, lng: STORE.lng });
    expect(d).toBeGreaterThan(9.9);
    expect(d).toBeLessThan(10.1);
  });
});

describe("isWithinDeliveryRadius", () => {
  it("true at exactly 9.99 km", () => {
    // Approximate ~9.99 km via 0.0899 deg lat
    expect(isWithinDeliveryRadius(STORE, { lat: STORE.lat + 0.0899, lng: STORE.lng })).toBe(true);
  });

  it("false at ~10.5 km", () => {
    expect(isWithinDeliveryRadius(STORE, { lat: STORE.lat + 0.0945, lng: STORE.lng })).toBe(false);
  });

  it("true at store location itself", () => {
    expect(isWithinDeliveryRadius(STORE, STORE)).toBe(true);
  });

  it("true at ~9 km (8–10km fallback band still in radius)", () => {
    expect(isWithinDeliveryRadius(STORE, { lat: STORE.lat + 0.081, lng: STORE.lng })).toBe(true);
  });
});

describe("coordsAreValid", () => {
  it("true for a real Mandy's-area coordinate", () => {
    expect(coordsAreValid(-28.0084, 153.4116)).toBe(true);
  });
  it("false for 0,0 (the 'unset' sentinel)", () => {
    expect(coordsAreValid(0, 0)).toBe(false);
  });
  it("false when only latitude is 0", () => {
    expect(coordsAreValid(0, 153.4116)).toBe(false);
  });
  it("false when only longitude is 0", () => {
    expect(coordsAreValid(-28.0084, 0)).toBe(false);
  });
  it("false for NaN", () => {
    expect(coordsAreValid(NaN, NaN)).toBe(false);
  });
  it("false for Infinity", () => {
    expect(coordsAreValid(Infinity, 153)).toBe(false);
  });
});
