import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSearchEvents = vi.fn();
const mockAdjust = vi.fn();
const mockProgramsGet = vi.fn();

vi.mock("@/lib/square", () => ({
  SQUARE_LOCATION_ID: "loc_test",
  squareClient: {
    loyalty: {
      searchEvents: (...a: unknown[]) => mockSearchEvents(...a),
      accounts: { adjust: (...a: unknown[]) => mockAdjust(...a) },
      programs: { get: (...a: unknown[]) => mockProgramsGet(...a) },
    },
  },
  findCustomerByPhone: vi.fn(),
}));

import { returnRedeemedStarsForOrder } from "./loyalty";

// Single reward tier costing 9 stars (the seller's "one free drink").
const PROGRAM = {
  program: { id: "prog1", rewardTiers: [{ id: "tier1", points: 9 }] },
};

describe("returnRedeemedStarsForOrder — credit back spent stars on full refund", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProgramsGet.mockResolvedValue(PROGRAM);
    mockAdjust.mockResolvedValue({});
  });

  it("credits starsPerReward back for one redeemed reward", async () => {
    mockSearchEvents.mockResolvedValue({
      events: [{ id: "ev1", loyaltyAccountId: "acc1" }],
    });

    const result = await returnRedeemedStarsForOrder("ord1", "ref1");

    expect(result).toEqual({ returned: 9, accountId: "acc1" });
    expect(mockAdjust).toHaveBeenCalledWith({
      accountId: "acc1",
      idempotencyKey: "refund-redeem-return-ref1",
      adjustPoints: {
        points: 9,
        reason: "Reward star return for refund ref1",
      },
    });
  });

  it("scales the credit by the number of redeemed rewards", async () => {
    mockSearchEvents.mockResolvedValue({
      events: [
        { loyaltyAccountId: "acc1" },
        { loyaltyAccountId: "acc1" },
      ],
    });

    const result = await returnRedeemedStarsForOrder("ord1", "ref2");

    expect(result.returned).toBe(18); // 2 rewards × 9
    expect(mockAdjust.mock.calls[0][0].adjustPoints.points).toBe(18);
  });

  it("no redemptions → no adjust, no program lookup needed", async () => {
    mockSearchEvents.mockResolvedValue({ events: [] });

    const result = await returnRedeemedStarsForOrder("ord2", "ref3");

    expect(result).toEqual({ returned: 0, accountId: null });
    expect(mockAdjust).not.toHaveBeenCalled();
  });

  it("idempotencyKey is deterministic from refundId (Square dedupes re-delivery)", async () => {
    mockSearchEvents.mockResolvedValue({
      events: [{ loyaltyAccountId: "acc1" }],
    });

    await returnRedeemedStarsForOrder("ord1", "refX");
    await returnRedeemedStarsForOrder("ord1", "refX");

    expect(mockAdjust).toHaveBeenCalledTimes(2);
    expect(mockAdjust.mock.calls[0][0].idempotencyKey).toBe(
      "refund-redeem-return-refX",
    );
    expect(mockAdjust.mock.calls[1][0].idempotencyKey).toBe(
      "refund-redeem-return-refX",
    );
  });
})
