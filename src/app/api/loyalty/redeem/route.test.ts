import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetAuthedUser = vi.fn();
const mockFindLoyaltyAccountByPhone = vi.fn();
const mockGetActiveProgram = vi.fn();
const mockRedeemReward = vi.fn();
const mockOrdersGet = vi.fn();
const mockRewardsDelete = vi.fn();

vi.mock("@/lib/auth", () => ({
  getAuthedUser: (req: Request) => mockGetAuthedUser(req),
}));
vi.mock("@/lib/loyalty", () => ({
  findLoyaltyAccountByPhone: (...args: unknown[]) =>
    mockFindLoyaltyAccountByPhone(...args),
  getActiveProgram: () => mockGetActiveProgram(),
  redeemReward: (...args: unknown[]) => mockRedeemReward(...args),
}));
vi.mock("@/lib/square", () => ({
  squareClient: {
    orders: { get: (args: unknown) => mockOrdersGet(args) },
    loyalty: {
      rewards: { delete: (args: unknown) => mockRewardsDelete(args) },
    },
  },
}));

import { POST } from "./route";

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/loyalty/redeem", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/loyalty/redeem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthedUser.mockResolvedValue({
      profile: { phone_e164: "+61400000001" },
    });
    mockFindLoyaltyAccountByPhone.mockResolvedValue({
      accountId: "acc1",
      balance: 27,
    });
    mockGetActiveProgram.mockResolvedValue({
      starsPerReward: 9,
      rewardTierId: "tier1",
    });
  });

  it("count=2 happy path: creates 2 rewards, refetches order once", async () => {
    mockRedeemReward
      .mockResolvedValueOnce({ loyaltyRewardId: "r1" })
      .mockResolvedValueOnce({ loyaltyRewardId: "r2" });
    // First orders.get: cup-count check
    mockOrdersGet.mockResolvedValueOnce({
      order: { lineItems: [{ quantity: "3" }] },
    });
    // Second orders.get: post-loop refetch
    mockOrdersGet.mockResolvedValueOnce({
      order: { totalMoney: { amount: 350n } },
    });

    const res = await POST(makeRequest({ orderId: "ord1", count: 2 }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.loyaltyRewardIds).toEqual(["r1", "r2"]);
    expect(json.loyaltyRewardId).toBe("r1");
    expect(json.remainingBalance).toBe(9);
    expect(json.updatedAmountCents).toBe("350");
    expect(mockRedeemReward).toHaveBeenCalledTimes(2);
    expect(mockRedeemReward).toHaveBeenNthCalledWith(1, "acc1", "tier1", "ord1");
    expect(mockRedeemReward).toHaveBeenNthCalledWith(2, "acc1", "tier1", "ord1");
    expect(mockRewardsDelete).not.toHaveBeenCalled();
  });

  it("count=2 with no orderId: creates 2 ISSUED rewards, never calls orders.get", async () => {
    mockRedeemReward
      .mockResolvedValueOnce({ loyaltyRewardId: "r1" })
      .mockResolvedValueOnce({ loyaltyRewardId: "r2" });

    const res = await POST(makeRequest({ count: 2 }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.loyaltyRewardIds).toEqual(["r1", "r2"]);
    expect(json.updatedAmountCents).toBeNull();
    expect(mockOrdersGet).not.toHaveBeenCalled();
    expect(mockRedeemReward).toHaveBeenCalledTimes(2);
    expect(mockRedeemReward).toHaveBeenNthCalledWith(1, "acc1", "tier1", undefined);
  });

  it("count defaults to 1 when omitted (back-compat)", async () => {
    mockRedeemReward.mockResolvedValueOnce({ loyaltyRewardId: "r1" });
    mockOrdersGet
      .mockResolvedValueOnce({
        order: { lineItems: [{ quantity: "1" }] },
      })
      .mockResolvedValueOnce({
        order: { totalMoney: { amount: 0n } },
      });

    const res = await POST(makeRequest({ orderId: "ord1" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.loyaltyRewardIds).toEqual(["r1"]);
    expect(mockRedeemReward).toHaveBeenCalledTimes(1);
  });

  it("count=0 rejected as 400", async () => {
    const res = await POST(makeRequest({ count: 0 }));
    expect(res.status).toBe(400);
    expect(mockRedeemReward).not.toHaveBeenCalled();
  });

  it("count=11 rejected as 400 (exceeds 10 hard cap)", async () => {
    const res = await POST(makeRequest({ count: 11 }));
    expect(res.status).toBe(400);
    expect(mockRedeemReward).not.toHaveBeenCalled();
  });

  it("count exceeds available stars rejected as 400", async () => {
    mockFindLoyaltyAccountByPhone.mockResolvedValue({
      accountId: "acc1",
      balance: 9,
    });
    const res = await POST(makeRequest({ count: 2 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Not enough stars/);
  });

  it("count > cupCount rejected as 400", async () => {
    mockOrdersGet.mockResolvedValueOnce({
      order: { lineItems: [{ quantity: "1" }] },
    });
    const res = await POST(makeRequest({ orderId: "ord1", count: 2 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Cannot redeem 2 rewards on a 1-cup order/);
    expect(mockRedeemReward).not.toHaveBeenCalled();
  });

  it("Square fails on the 2nd create: rolls back the 1st reward, returns 502", async () => {
    mockRedeemReward
      .mockResolvedValueOnce({ loyaltyRewardId: "r1" })
      .mockRejectedValueOnce(new Error("Square 5xx"));
    mockOrdersGet.mockResolvedValueOnce({
      order: { lineItems: [{ quantity: "3" }] },
    });
    mockRewardsDelete.mockResolvedValue({});

    const res = await POST(makeRequest({ orderId: "ord1", count: 2 }));
    expect(res.status).toBe(502);
    expect(mockRedeemReward).toHaveBeenCalledTimes(2);
    expect(mockRewardsDelete).toHaveBeenCalledTimes(1);
    expect(mockRewardsDelete).toHaveBeenCalledWith({ rewardId: "r1" });
  });

  it("rollback delete failure is logged but still returns 502 with original error", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockRedeemReward
      .mockResolvedValueOnce({ loyaltyRewardId: "r1" })
      .mockRejectedValueOnce(new Error("Square 5xx"));
    mockOrdersGet.mockResolvedValueOnce({
      order: { lineItems: [{ quantity: "3" }] },
    });
    mockRewardsDelete.mockRejectedValue(new Error("delete also failed"));

    const res = await POST(makeRequest({ orderId: "ord1", count: 2 }));
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toMatch(/Square 5xx/);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[loyalty-rollback-failed]"),
      expect.anything(),
    );
    consoleSpy.mockRestore();
  });
});
