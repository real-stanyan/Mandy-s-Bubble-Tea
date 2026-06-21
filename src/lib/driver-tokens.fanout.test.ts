import { describe, it, expect, vi, beforeEach } from "vitest";

// Fan-out behaviour for updateDriverLocation: a driver carrying stacked orders
// only streams GPS for the one order the app currently tracks. The ingestion
// must fan each fix out to ALL of that driver's in-progress dispatches so the
// earlier orders don't freeze to "Location paused" while the driver is moving.

let lookupResult: { data: unknown; error: { message: string } | null };
let updateResult: { error: { message: string } | null };
const calls: Record<string, unknown> = {};

const mkThenable = (
  value: unknown,
  extra: Record<string, unknown> = {},
) => ({
  ...extra,
  then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(value).then(resolve, reject),
});

const mockFrom = vi.fn(() => ({
  select: () => ({
    eq: (col: string, val: string) => ({
      maybeSingle: () => {
        calls.lookupEq = [col, val];
        return Promise.resolve(lookupResult);
      },
    }),
  }),
  update: (patch: unknown) => {
    calls.patch = patch;
    return {
      eq: (col: string, val: string) => {
        calls.updateEq = [col, val];
        return mkThenable(updateResult, {
          in: (scol: string, arr: string[]) => {
            calls.updateIn = [scol, arr];
            return Promise.resolve(updateResult);
          },
        });
      },
    };
  },
}));

vi.mock("./supabase-server", () => ({
  getSupabaseAdmin: () => ({ from: mockFrom }),
}));

import { updateDriverLocation } from "./driver-tokens";

describe("updateDriverLocation fan-out", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(calls)) delete calls[k];
    lookupResult = { data: { driver_id: "D1" }, error: null };
    updateResult = { error: null };
  });

  it("fans the fix out to all in-progress dispatches for the same driver", async () => {
    await updateDriverLocation({ orderId: "DE841", lat: -27.95, lng: 153.41, heading: 90 });
    // looked up the driver from the posted order
    expect(calls.lookupEq).toEqual(["order_id", "DE841"]);
    // updated by driver, filtered to the still-delivering states
    expect(calls.updateEq).toEqual(["driver_id", "D1"]);
    expect(calls.updateIn).toEqual(["status", ["accepted", "picked_up"]]);
    // wrote the fix + a fresh timestamp
    const patch = calls.patch as Record<string, unknown>;
    expect(patch.driver_lat).toBe(-27.95);
    expect(patch.driver_lng).toBe(153.41);
    expect(patch.driver_heading).toBe(90);
    expect(typeof patch.location_updated_at).toBe("string");
  });

  it("falls back to single-order update when the dispatch has no driver_id", async () => {
    lookupResult = { data: { driver_id: null }, error: null };
    await updateDriverLocation({ orderId: "DE836", lat: -27.96, lng: 153.4 });
    expect(calls.updateEq).toEqual(["order_id", "DE836"]);
    expect(calls.updateIn).toBeUndefined();
    expect((calls.patch as Record<string, unknown>).driver_heading).toBeNull();
  });

  it("throws when the driver lookup errors", async () => {
    lookupResult = { data: null, error: { message: "lookup boom" } };
    await expect(
      updateDriverLocation({ orderId: "DE841", lat: 1, lng: 1 }),
    ).rejects.toThrow("lookup boom");
  });

  it("throws when the fan-out update errors", async () => {
    updateResult = { error: { message: "update boom" } };
    await expect(
      updateDriverLocation({ orderId: "DE841", lat: 1, lng: 1 }),
    ).rejects.toThrow("update boom");
  });
});
