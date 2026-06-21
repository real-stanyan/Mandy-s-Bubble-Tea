import { describe, it, expect, vi, beforeEach } from "vitest";

// A mutable driver identity so the route's `auth.driver.prefs = ...` write is
// observable by buildState within the same request.
let driver: Record<string, unknown>;
const setLocationModeMock = vi.fn();

vi.mock("@/lib/driver-auth", () => ({
  authDriver: async () => ({ ok: true, reason: "ok", role: "driver", driverId: "d1", driver }),
}));

vi.mock("@/lib/driver-shifts", () => ({
  getOpenShift: async () => null, // OFF shift — the previously-broken case
  startShift: async () => ({ id: "s1", startedAt: "2026-06-21T00:00:00Z", locationMode: "while" }),
  endShift: async () => undefined,
  setLocationMode: (...a: unknown[]) => setLocationModeMock(...a),
  updateDriverPrefs: async () => ({}),
  getDeliveredDispatchForDriver: async () => [],
}));

vi.mock("@/lib/order-hydrate", () => ({ hydrateOrders: async () => ({}) }));
vi.mock("@/lib/brisbane-date", () => ({ isBrisbaneToday: () => false }));

import { POST } from "./route";

function post(body: unknown): Request {
  return new Request("http://localhost/api/driver/shift", {
    method: "POST",
    headers: { authorization: "Bearer driver-secret" },
    body: JSON.stringify(body),
  });
}

describe("POST set_location_mode — works off-shift", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    driver = {
      name: "Stan", suburb: null, phone: null, vehicle: null,
      joinedAt: null, rating: null, prefs: {},
    };
    // setLocationMode persists to drivers.prefs and returns the merged prefs.
    setLocationModeMock.mockImplementation(async (_id: string, mode: string) => ({ locationMode: mode }));
  });

  it("returns the newly-set 'always' mode even with no open shift", async () => {
    const res = await POST(post({ action: "set_location_mode", locationMode: "always" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.locationMode).toBe("always");
    expect(setLocationModeMock).toHaveBeenCalledWith("d1", "always");
  });

  it("GET-style state reflects the persisted pref (driver.prefs seeds locationMode)", async () => {
    driver.prefs = { locationMode: "always" };
    setLocationModeMock.mockImplementation(async (_id: string, mode: string) => ({ locationMode: mode }));
    // A no-op-ish toggle back to the same value still echoes the persisted mode.
    const res = await POST(post({ action: "set_location_mode", locationMode: "always" }));
    const json = await res.json();
    expect(json.locationMode).toBe("always");
  });
});
