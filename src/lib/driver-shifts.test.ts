import { describe, it, expect, vi, beforeEach } from "vitest";

// Chainable supabase-admin stub. Each `.from(table)` records the table and
// returns a builder whose terminal calls resolve to whatever we queued.
let lastFrom = "";
const updateSpy = vi.fn();
let driverPrefsRow: Record<string, unknown> | null = null;

function makeBuilder() {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = chain;
  builder.eq = chain;
  builder.is = chain;
  builder.update = (patch: unknown) => {
    updateSpy(lastFrom, patch);
    return builder;
  };
  builder.maybeSingle = async () => ({ data: { prefs: driverPrefsRow }, error: null });
  return builder;
}

vi.mock("./supabase-server", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      lastFrom = table;
      return makeBuilder();
    },
  }),
}));

import { setLocationMode } from "./driver-shifts";

describe("setLocationMode — persists as a driver preference (survives off-shift)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    driverPrefsRow = null;
  });

  it("writes locationMode into drivers.prefs, not driver_shifts", async () => {
    const merged = await setLocationMode("driver-1", "always");
    // Must persist on the drivers row (off-shift safe), never driver_shifts.
    const tables = updateSpy.mock.calls.map((c) => c[0]);
    expect(tables).toContain("drivers");
    expect(tables).not.toContain("driver_shifts");
    expect(merged.locationMode).toBe("always");
  });

  it("merges into existing prefs without clobbering other keys", async () => {
    driverPrefsRow = { alertsEnabled: false, navApp: "google_maps" };
    const merged = await setLocationMode("driver-1", "while");
    expect(merged).toMatchObject({
      alertsEnabled: false,
      navApp: "google_maps",
      locationMode: "while",
    });
    // The write payload carries the merged prefs.
    const driversUpdate = updateSpy.mock.calls.find((c) => c[0] === "drivers");
    expect(driversUpdate?.[1]).toEqual({ prefs: merged });
  });
});
