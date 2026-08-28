import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetAuthedUser = vi.fn();
const mockFindLoyaltyAccountByPhone = vi.fn();
const mockGetActiveProgram = vi.fn();
const mockRedeemReward = vi.fn();
const mockReclaimStrandedRewards = vi.fn();
const mockOrdersGet = vi.fn();
const mockRewardsDelete = vi.fn();
const mockAccountsGet = vi.fn();

vi.mock("@/lib/auth", () => ({
  getAuthedUser: (req: Request) => mockGetAuthedUser(req),
}));
vi.mock("@/lib/loyalty", () => ({
  findLoyaltyAccountByPhone: (...args: unknown[]) =>
    mockFindLoyaltyAccountByPhone(...args),
  getActiveProgram: () => mockGetActiveProgram(),
  redeemReward: (...args: unknown[]) => mockRedeemReward(...args),
  reclaimStrandedRewards: (...args: unknown[]) =>
    mockReclaimStrandedRewards(...args),
}));
vi.mock("@/lib/square", () => ({
  squareClient: {
    orders: { get: (args: unknown) => mockOrdersGet(args) },
    loyalty: {
      rewards: { delete: (args: unknown) => mockRewardsDelete(args) },
      accounts: { get: (args: unknown) => mockAccountsGet(args) },
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

  it("count exceeds available stars rejected as 400 (nothing to reclaim)", async () => {
    mockFindLoyaltyAccountByPhone.mockResolvedValue({
      accountId: "acc1",
      balance: 9,
    });
    mockReclaimStrandedRewards.mockResolvedValue({ reclaimed: 0 });
    const res = await POST(makeRequest({ count: 2 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Not enough stars/);
    // The self-heal ran before giving up, excluding the current order.
    expect(mockReclaimStrandedRewards).toHaveBeenCalledWith("acc1", {
      excludeOrderId: undefined,
    });
  });

  it("insufficient balance self-heals: stranded holds released, balance re-read, redeem proceeds", async () => {
    // The 2026-08-28 incident: app shows 24 stars, server says 6 — the
    // other 18 were ISSUED rewards pinned to an abandoned declined-card
    // order. The route must release them and answer with the redeem the
    // customer is owed, not "Not enough stars".
    mockFindLoyaltyAccountByPhone.mockResolvedValue({
      accountId: "acc1",
      balance: 6,
    });
    mockReclaimStrandedRewards.mockResolvedValue({ reclaimed: 2 });
    mockAccountsGet.mockResolvedValue({ loyaltyAccount: { balance: 24 } });
    mockRedeemReward
      .mockResolvedValueOnce({ loyaltyRewardId: "r1" })
      .mockResolvedValueOnce({ loyaltyRewardId: "r2" });
    // cup-count check + post-redeem refetch
    mockOrdersGet
      .mockResolvedValueOnce({ order: { lineItems: [{ quantity: "5" }] } })
      .mockResolvedValueOnce({ order: { totalMoney: { amount: 2100n } } });

    const res = await POST(makeRequest({ orderId: "ORDER_NEW", count: 2 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.loyaltyRewardIds).toEqual(["r1", "r2"]);
    expect(json.remainingBalance).toBe(24 - 18);
    expect(mockReclaimStrandedRewards).toHaveBeenCalledWith("acc1", {
      excludeOrderId: "ORDER_NEW",
    });
  });

  it("balance sufficient: reclaim is never called", async () => {
    mockRedeemReward.mockResolvedValueOnce({ loyaltyRewardId: "r1" });
    const res = await POST(makeRequest({ count: 1 }));
    expect(res.status).toBe(200);
    expect(mockReclaimStrandedRewards).not.toHaveBeenCalled();
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

describe("POST /api/loyalty/redeem — same-order idempotency guard (double redeem)", () => {
  // App checkout retries reuse the SAME OPEN order (order idempotency key),
  // so this route can be hit twice for one order. The second call must not
  // create another reward (double star deduction + stacked free-drink
  // discount) and must not die on the balance check — the first redemption
  // already deducted the stars.
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthedUser.mockResolvedValue({
      profile: { phone_e164: "+61400000001" },
    });
    mockGetActiveProgram.mockResolvedValue({
      starsPerReward: 9,
      rewardTierId: "tier1",
    });
  });

  it("order already has >= count rewards → idempotent 200, NO new reward, stars not re-deducted", async () => {
    mockFindLoyaltyAccountByPhone.mockResolvedValue({
      accountId: "acc1",
      balance: 3, // post-first-redemption balance
    });
    mockOrdersGet.mockResolvedValueOnce({
      order: {
        lineItems: [{ quantity: "1" }],
        rewards: [{ id: "rew1", rewardTierId: "tier1" }],
        totalMoney: { amount: 150n }, // current total, reward already applied
      },
    });

    const res = await POST(makeRequest({ orderId: "ord1", count: 1 }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.updatedAmountCents).toBe("150");
    expect(mockRedeemReward).not.toHaveBeenCalled();
    expect(mockRewardsDelete).not.toHaveBeenCalled();
    // Exact same response shape as the create path.
    expect(Object.keys(json).sort()).toEqual(
      [
        "ok",
        "loyaltyRewardIds",
        "loyaltyRewardId",
        "remainingBalance",
        "updatedAmountCents",
      ].sort(),
    );
    expect(json.loyaltyRewardIds).toEqual(["rew1"]);
    expect(json.loyaltyRewardId).toBe("rew1");
    // Current balance IS the post-redemption balance — no second deduction.
    expect(json.remainingBalance).toBe(3);
  });

  it("retry after the first redeem drained the balance → still idempotent 200 (guard runs before the balance check)", async () => {
    mockFindLoyaltyAccountByPhone.mockResolvedValue({
      accountId: "acc1",
      balance: 0, // first redemption consumed everything
    });
    mockOrdersGet.mockResolvedValueOnce({
      order: {
        lineItems: [{ quantity: "1" }],
        rewards: [{ id: "rew1", rewardTierId: "tier1" }],
        totalMoney: { amount: 0n },
      },
    });

    const res = await POST(makeRequest({ orderId: "ord1", count: 1 }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.updatedAmountCents).toBe("0");
    expect(json.remainingBalance).toBe(0);
    expect(mockRedeemReward).not.toHaveBeenCalled();
  });

  it("order has FEWER rewards than count → proceeds through the normal create path", async () => {
    mockFindLoyaltyAccountByPhone.mockResolvedValue({
      accountId: "acc1",
      balance: 20,
    });
    mockOrdersGet
      .mockResolvedValueOnce({
        order: {
          lineItems: [{ quantity: "3" }],
          rewards: [{ id: "rew1", rewardTierId: "tier1" }],
          totalMoney: { amount: 1200n },
        },
      })
      // post-loop refetch
      .mockResolvedValueOnce({
        order: { totalMoney: { amount: 400n } },
      });
    mockRedeemReward
      .mockResolvedValueOnce({ loyaltyRewardId: "rew2" })
      .mockResolvedValueOnce({ loyaltyRewardId: "rew3" });

    const res = await POST(makeRequest({ orderId: "ord1", count: 2 }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(mockRedeemReward).toHaveBeenCalledTimes(2);
    expect(json.loyaltyRewardIds).toEqual(["rew2", "rew3"]);
    expect(json.remainingBalance).toBe(20 - 9 * 2);
    expect(json.updatedAmountCents).toBe("400");
  });
});
