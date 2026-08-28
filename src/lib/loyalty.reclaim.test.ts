import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRewardsSearch = vi.fn();
const mockRewardsDelete = vi.fn();
const mockOrdersGet = vi.fn();

vi.mock("@/lib/square", () => ({
  SQUARE_LOCATION_ID: "loc_test",
  squareClient: {
    loyalty: {
      rewards: {
        search: (...args: unknown[]) => mockRewardsSearch(...args),
        delete: (...args: unknown[]) => mockRewardsDelete(...args),
      },
    },
    orders: { get: (...args: unknown[]) => mockOrdersGet(...args) },
  },
  findCustomerByPhone: vi.fn(),
}));

import { reclaimStrandedRewards } from "./loyalty";

const issued = (id: string, orderId: string, createdAt = new Date().toISOString()) => ({
  id,
  orderId,
  status: "ISSUED",
  createdAt,
});

describe("reclaimStrandedRewards — bug `stranded-reward-holds-2026-08-28`", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRewardsDelete.mockResolvedValue({});
  });

  it("releases an ISSUED reward whose order is unpaid with no live tender", async () => {
    mockRewardsSearch.mockResolvedValue({ rewards: [issued("r1", "DEAD1")] });
    mockOrdersGet.mockResolvedValue({
      order: {
        state: "OPEN",
        totalMoney: { amount: 1400n },
        netAmountDueMoney: { amount: 1400n },
        tenders: [{ cardDetails: { status: "FAILED" } }],
      },
    });
    const { reclaimed } = await reclaimStrandedRewards("acc1");
    expect(reclaimed).toBe(1);
    expect(mockRewardsDelete).toHaveBeenCalledWith({ rewardId: "r1" });
  });

  it("keeps a reward whose order holds an AUTHORIZED card (delivery pre-accept)", async () => {
    mockRewardsSearch.mockResolvedValue({ rewards: [issued("r1", "HELD1")] });
    mockOrdersGet.mockResolvedValue({
      order: {
        state: "OPEN",
        totalMoney: { amount: 2255n },
        netAmountDueMoney: { amount: 2255n },
        tenders: [{ cardDetails: { status: "AUTHORIZED" } }],
      },
    });
    const { reclaimed } = await reclaimStrandedRewards("acc1");
    expect(reclaimed).toBe(0);
    expect(mockRewardsDelete).not.toHaveBeenCalled();
  });

  it("keeps a paid order's reward and skips the excluded (current) order", async () => {
    mockRewardsSearch.mockResolvedValue({
      rewards: [issued("r1", "PAID1"), issued("r2", "CURRENT")],
    });
    mockOrdersGet.mockResolvedValue({
      order: {
        state: "OPEN",
        totalMoney: { amount: 900n },
        netAmountDueMoney: { amount: 0n },
        tenders: [{ cardDetails: { status: "CAPTURED" } }],
      },
    });
    const { reclaimed } = await reclaimStrandedRewards("acc1", {
      excludeOrderId: "CURRENT",
    });
    expect(reclaimed).toBe(0);
    // The excluded order was never even looked up.
    expect(mockOrdersGet).toHaveBeenCalledTimes(1);
  });

  it("respects minAgeMs — a young hold may belong to a live checkout", async () => {
    mockRewardsSearch.mockResolvedValue({
      rewards: [issued("r1", "YOUNG1", new Date(Date.now() - 60_000).toISOString())],
    });
    const { reclaimed } = await reclaimStrandedRewards("acc1", {
      minAgeMs: 30 * 60 * 1000,
    });
    expect(reclaimed).toBe(0);
    expect(mockOrdersGet).not.toHaveBeenCalled();
  });

  it("releases a CANCELED order's reward and survives a per-reward failure", async () => {
    mockRewardsSearch.mockResolvedValue({
      rewards: [issued("r1", "BROKEN"), issued("r2", "CANCELED1")],
    });
    mockOrdersGet
      .mockRejectedValueOnce(new Error("order lookup down"))
      .mockResolvedValueOnce({ order: { state: "CANCELED" } });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { reclaimed } = await reclaimStrandedRewards("acc1");
    consoleErrorSpy.mockRestore();
    expect(reclaimed).toBe(1);
    expect(mockRewardsDelete).toHaveBeenCalledWith({ rewardId: "r2" });
  });
});
