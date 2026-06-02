import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAccumulate = vi.fn();

vi.mock("@/lib/square", () => ({
  SQUARE_LOCATION_ID: "loc_test",
  squareClient: {
    loyalty: { accounts: { accumulatePoints: (...a: unknown[]) => mockAccumulate(...a) } },
  },
  findCustomerByPhone: vi.fn(),
}));

import { accrueForOrder } from "./loyalty";

describe("accrueForOrder idempotency key", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the supplied idempotency key when given", async () => {
    mockAccumulate.mockResolvedValue({});
    await accrueForOrder("acc1", "ord1", "backfill:ord1");
    expect(mockAccumulate).toHaveBeenCalledWith({
      accountId: "acc1",
      idempotencyKey: "backfill:ord1",
      locationId: "loc_test",
      accumulatePoints: { orderId: "ord1" },
    });
  });
});
