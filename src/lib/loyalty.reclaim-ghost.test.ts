import { describe, it, expect, vi, beforeEach } from "vitest";

// Ghost $0 orders (OL890, 2026-09-06): rewards ISSUED, order OPEN/$0/no
// tender, checkout never finished, nothing printed. Square cannot tell it
// from a settled free drink; the print ledger (ghost-zero-order.ts) can. The
// reclaim must release such rewards — but only once they are old enough that
// no client can still be mid-checkout on them.

const mockRewardsSearch = vi.fn();
const mockRewardsDelete = vi.fn();
const mockOrdersGet = vi.fn();
const mockGhost = vi.fn();

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
vi.mock("@/lib/orders/ghost-zero-order", () => ({
  isGhostZeroOrder: (...args: unknown[]) => mockGhost(...args),
}));

import { reclaimStrandedRewards } from "./loyalty";

const minutesAgo = (m: number) => new Date(Date.now() - m * 60 * 1000).toISOString();
const issued = (id: string, orderId: string, createdAt: string) => ({ id, orderId, status: "ISSUED", createdAt });
const ZERO_OPEN = {
  id: "OL890",
  state: "OPEN",
  totalMoney: { amount: 0n },
  netAmountDueMoney: { amount: 0n },
  tenders: [],
};

describe("reclaimStrandedRewards — ghost $0 orders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRewardsDelete.mockResolvedValue({});
    mockOrdersGet.mockResolvedValue({ order: ZERO_OPEN });
  });

  it("releases a 40-minute-old reward pinned to a never-settled $0 order", async () => {
    mockRewardsSearch.mockResolvedValue({ rewards: [issued("r1", "OL890", minutesAgo(40))] });
    mockGhost.mockResolvedValue(true);
    const { reclaimed } = await reclaimStrandedRewards("acc1");
    expect(reclaimed).toBe(1);
    expect(mockGhost).toHaveBeenCalledWith(expect.objectContaining({ id: "OL890" }));
    expect(mockRewardsDelete).toHaveBeenCalledWith({ rewardId: "r1" });
  });

  it("leaves a young $0 reward alone without even consulting the ledger", async () => {
    mockRewardsSearch.mockResolvedValue({ rewards: [issued("r1", "OL890", minutesAgo(5))] });
    const { reclaimed } = await reclaimStrandedRewards("acc1");
    expect(reclaimed).toBe(0);
    expect(mockGhost).not.toHaveBeenCalled();
    expect(mockRewardsDelete).not.toHaveBeenCalled();
  });

  it("keeps a settled $0 order's reward (ledger row present)", async () => {
    mockRewardsSearch.mockResolvedValue({ rewards: [issued("r1", "OL891", minutesAgo(40))] });
    mockGhost.mockResolvedValue(false);
    const { reclaimed } = await reclaimStrandedRewards("acc1");
    expect(reclaimed).toBe(0);
    expect(mockRewardsDelete).not.toHaveBeenCalled();
  });

  it("an unpaid (due > 0) dead order is released by the old rule, no ledger needed", async () => {
    mockRewardsSearch.mockResolvedValue({ rewards: [issued("r1", "DEAD1", minutesAgo(40))] });
    mockOrdersGet.mockResolvedValue({
      order: { state: "OPEN", totalMoney: { amount: 1400n }, netAmountDueMoney: { amount: 1400n }, tenders: [] },
    });
    const { reclaimed } = await reclaimStrandedRewards("acc1");
    expect(reclaimed).toBe(1);
    expect(mockGhost).not.toHaveBeenCalled();
  });
});
