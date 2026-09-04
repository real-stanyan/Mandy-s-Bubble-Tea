import { describe, it, expect, vi, beforeEach } from "vitest";

const { search } = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock("@/lib/square", () => ({
  squareClient: { orders: { search: (args: unknown) => search(args) } },
  SQUARE_LOCATION_ID: "LOC1",
}));

import {
  countPendingCups,
  getKitchenLoad,
  __resetKitchenLoadCacheForTests,
} from "./kitchen-load-server";

const NOW = new Date("2026-09-04T02:20:00.000Z"); // 12:20pm Brisbane

function order(
  cups: number[],
  opts: {
    state?: string;
    fulfillmentState?: string;
    scheduleType?: "ASAP" | "SCHEDULED";
    pickupAt?: string;
    itemType?: string;
  } = {},
) {
  return {
    state: opts.state ?? "COMPLETED",
    fulfillments: [
      {
        type: "PICKUP",
        state: opts.fulfillmentState ?? "COMPLETED",
        pickupDetails: {
          scheduleType: opts.scheduleType ?? "ASAP",
          pickupAt: opts.pickupAt ?? NOW.toISOString(),
        },
      },
    ],
    lineItems: cups.map((q) => ({ quantity: String(q), itemType: opts.itemType ?? "ITEM" })),
  };
}

describe("countPendingCups", () => {
  beforeEach(() => {
    search.mockReset();
    __resetKitchenLoadCacheForTests();
  });

  it("asks Square for everything created in the last 10 minutes, any state", async () => {
    search.mockResolvedValue({ orders: [] });
    await countPendingCups(NOW);
    const args = search.mock.calls[0][0] as {
      locationIds: string[];
      query: { filter: Record<string, unknown> };
    };
    expect(args.locationIds).toEqual(["LOC1"]);
    expect(args.query.filter).toEqual({
      dateTimeFilter: { createdAt: { startAt: "2026-09-04T02:10:00.000Z" } },
    });
    // Square completes POS and online orders the moment they're paid, so a
    // state filter would count nothing (2026-09-04 lunch service).
    expect(args.query.filter).not.toHaveProperty("stateFilter");
  });

  it("sums cups across POS and online orders regardless of Square state", async () => {
    search.mockResolvedValue({
      orders: [
        order([1], { state: "COMPLETED" }), // walk-in, completed on payment
        order([2, 1], { state: "OPEN", fulfillmentState: "PROPOSED" }), // web order just landed
        order([3], { state: "COMPLETED" }), // online pickup the register closed already
      ],
    });
    expect(await countPendingCups(NOW)).toBe(7);
  });

  it("ignores cancelled orders and non-drink lines", async () => {
    search.mockResolvedValue({
      orders: [
        order([4], { state: "CANCELED" }),
        order([2], { fulfillmentState: "CANCELED" }),
        order([9], { itemType: "CUSTOM_AMOUNT" }),
        order([1]),
      ],
    });
    expect(await countPendingCups(NOW)).toBe(1);
  });

  it("leaves a scheduled pickup off the bench until the print queue releases it", async () => {
    const inAnHour = new Date(NOW.getTime() + 60 * 60 * 1000).toISOString();
    const inFourMin = new Date(NOW.getTime() + 4 * 60 * 1000).toISOString();
    search.mockResolvedValue({
      orders: [
        order([5], { scheduleType: "SCHEDULED", pickupAt: inAnHour }),
        order([2], { scheduleType: "SCHEDULED", pickupAt: inFourMin }),
      ],
    });
    expect(await countPendingCups(NOW)).toBe(2);
  });

  it("returns null, not a guess, when Square fails", async () => {
    search.mockRejectedValue(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await countPendingCups(NOW)).toBeNull();
    spy.mockRestore();
  });
});

describe("getKitchenLoad", () => {
  beforeEach(() => {
    search.mockReset();
    __resetKitchenLoadCacheForTests();
  });

  it("brackets the count and caches it for 30s", async () => {
    search.mockResolvedValue({ orders: [order([4, 4])] });
    expect(await getKitchenLoad(NOW)).toMatchObject({ level: "medium", pendingCups: 8 });
    await getKitchenLoad(new Date(NOW.getTime() + 20_000));
    expect(search).toHaveBeenCalledTimes(1);
    await getKitchenLoad(new Date(NOW.getTime() + 31_000));
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("caches a failure too, so a Square outage is not hammered every poll", async () => {
    search.mockRejectedValue(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await getKitchenLoad(NOW)).toBeNull();
    expect(await getKitchenLoad(new Date(NOW.getTime() + 5_000))).toBeNull();
    expect(search).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
