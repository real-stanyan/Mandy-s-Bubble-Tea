import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSearchEvents = vi.fn();
const mockAdjust = vi.fn();

vi.mock("@/lib/square", () => ({
  SQUARE_LOCATION_ID: "loc_test",
  squareClient: {
    loyalty: {
      searchEvents: (...args: unknown[]) => mockSearchEvents(...args),
      accounts: { adjust: (...args: unknown[]) => mockAdjust(...args) },
    },
  },
  findCustomerByPhone: vi.fn(),
}));

import { reverseAccrualForOrder } from "./loyalty";

describe("reverseAccrualForOrder — bug `loyalty-refund-no-reverse-2026-05-18`", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sums accrual points and calls adjust with negative total", async () => {
    mockSearchEvents.mockResolvedValue({
      events: [
        {
          id: "ev1",
          loyaltyAccountId: "acc1",
          accumulatePoints: { points: 2, orderId: "ord1" },
        },
      ],
    });
    mockAdjust.mockResolvedValue({});

    const result = await reverseAccrualForOrder("ord1", "ref1");

    expect(result).toEqual({ reversed: 2, accountId: "acc1" });
    expect(mockAdjust).toHaveBeenCalledWith({
      accountId: "acc1",
      idempotencyKey: "refund-reverse-ref1",
      adjustPoints: {
        points: -2,
        reason: "Refund reversal for refund ref1",
      },
    });
  });

  it("no accrual events → no adjust call", async () => {
    mockSearchEvents.mockResolvedValue({ events: [] });

    const result = await reverseAccrualForOrder("ord2", "ref2");

    expect(result).toEqual({ reversed: 0, accountId: null });
    expect(mockAdjust).not.toHaveBeenCalled();
  });

  it("idempotencyKey is deterministic from refundId", async () => {
    mockSearchEvents.mockResolvedValue({
      events: [
        {
          loyaltyAccountId: "acc1",
          accumulatePoints: { points: 1, orderId: "ord1" },
        },
      ],
    });
    mockAdjust.mockResolvedValue({});

    await reverseAccrualForOrder("ord1", "refX");
    await reverseAccrualForOrder("ord1", "refX");

    expect(mockAdjust).toHaveBeenCalledTimes(2);
    const firstKey = mockAdjust.mock.calls[0][0].idempotencyKey;
    const secondKey = mockAdjust.mock.calls[1][0].idempotencyKey;
    expect(firstKey).toBe(secondKey);
    expect(firstKey).toBe("refund-reverse-refX");
  });

  it("sums multiple ACCUMULATE_POINTS events for the same order", async () => {
    mockSearchEvents.mockResolvedValue({
      events: [
        { loyaltyAccountId: "acc1", accumulatePoints: { points: 2 } },
        { loyaltyAccountId: "acc1", accumulatePoints: { points: 1 } },
      ],
    });
    mockAdjust.mockResolvedValue({});

    const result = await reverseAccrualForOrder("ord1", "refY");

    expect(result.reversed).toBe(3);
    expect(mockAdjust.mock.calls[0][0].adjustPoints.points).toBe(-3);
  });
});
