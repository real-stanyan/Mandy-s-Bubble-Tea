import { describe, it, expect, vi, beforeEach } from "vitest";

const mockOrdersGet = vi.fn();
const mockCustomersGet = vi.fn();
const mockSearchEvents = vi.fn();
const mockFindOrCreate = vi.fn();
const mockAccrue = vi.fn();
const mockClaim = vi.fn();
const mockRelease = vi.fn();
const mockRecord = vi.fn();

vi.mock("@/lib/square", () => ({
  SQUARE_LOCATION_ID: "loc_test",
  squareClient: {
    orders: { get: (...a: unknown[]) => mockOrdersGet(...a) },
    customers: { get: (...a: unknown[]) => mockCustomersGet(...a) },
    loyalty: { searchEvents: (...a: unknown[]) => mockSearchEvents(...a) },
  },
}));
vi.mock("@/lib/loyalty", () => ({
  findOrCreateLoyaltyAccount: (...a: unknown[]) => mockFindOrCreate(...a),
  accrueForOrder: (...a: unknown[]) => mockAccrue(...a),
}));
vi.mock("@/lib/loyalty-backfill-log", () => ({
  claimBackfillSlot: (...a: unknown[]) => mockClaim(...a),
  releaseBackfillSlot: (...a: unknown[]) => mockRelease(...a),
  recordBackfillResult: (...a: unknown[]) => mockRecord(...a),
}));

import { backfillAccrualForOrder } from "./loyalty-backfill";

const paidOrder = (over = {}) => ({
  order: {
    id: "ord1",
    state: "COMPLETED",
    customerId: "cust1",
    totalMoney: { amount: 700n },
    tenders: [{ type: "CARD", cardDetails: { status: "CAPTURED" } }],
    ...over,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  mockClaim.mockResolvedValue(true);
  mockSearchEvents.mockResolvedValue({ events: [] });
  mockCustomersGet.mockResolvedValue({ customer: { phoneNumber: "+61400000000" } });
  mockFindOrCreate.mockResolvedValue({ accountId: "acc1", balance: 0, lifetimePoints: 0 });
  mockAccrue.mockResolvedValue(undefined);
});

describe("backfillAccrualForOrder", () => {
  it("accrues for a paid order with customer + no prior accrual", async () => {
    mockOrdersGet.mockResolvedValue(paidOrder());
    const r = await backfillAccrualForOrder("ord1", "cron");
    expect(r.status).toBe("accrued");
    expect(mockAccrue).toHaveBeenCalledWith("acc1", "ord1", "backfill:ord1");
    expect(mockRecord).toHaveBeenCalledWith("ord1", "acc1");
  });

  it("skips an unpaid order", async () => {
    mockOrdersGet.mockResolvedValue(paidOrder({ state: "OPEN", tenders: [] }));
    const r = await backfillAccrualForOrder("ord1", "cron");
    expect(r.status).toBe("skipped");
    expect(r.reason).toBe("not_paid");
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it("skips an order with no customer", async () => {
    mockOrdersGet.mockResolvedValue(paidOrder({ customerId: undefined }));
    const r = await backfillAccrualForOrder("ord1", "cron");
    expect(r.reason).toBe("no_customer");
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it("skips when slot already claimed (idempotency)", async () => {
    mockOrdersGet.mockResolvedValue(paidOrder());
    mockClaim.mockResolvedValue(false);
    const r = await backfillAccrualForOrder("ord1", "cron");
    expect(r.reason).toBe("already_logged");
    expect(mockAccrue).not.toHaveBeenCalled();
  });

  it("releases slot + returns already when Square already accrued", async () => {
    mockOrdersGet.mockResolvedValue(paidOrder());
    mockSearchEvents.mockResolvedValue({ events: [{ id: "ev1" }] });
    const r = await backfillAccrualForOrder("ord1", "cron");
    expect(r.status).toBe("already");
    expect(mockRelease).toHaveBeenCalledWith("ord1");
    expect(mockAccrue).not.toHaveBeenCalled();
  });

  it("enrolls when no account exists then accrues", async () => {
    mockOrdersGet.mockResolvedValue(paidOrder());
    await backfillAccrualForOrder("ord1", "webhook");
    expect(mockFindOrCreate).toHaveBeenCalledWith("cust1", "+61400000000");
    expect(mockAccrue).toHaveBeenCalled();
  });

  it("releases slot + returns no_phone when customer has no phone", async () => {
    mockOrdersGet.mockResolvedValue(paidOrder());
    mockCustomersGet.mockResolvedValue({ customer: { phoneNumber: undefined } });
    const r = await backfillAccrualForOrder("ord1", "cron");
    expect(r.reason).toBe("no_phone");
    expect(mockRelease).toHaveBeenCalledWith("ord1");
  });

  it("releases slot when accrual throws", async () => {
    mockOrdersGet.mockResolvedValue(paidOrder());
    mockAccrue.mockRejectedValue(new Error("square down"));
    const r = await backfillAccrualForOrder("ord1", "cron");
    expect(r.status).toBe("skipped");
    expect(r.reason).toBe("error");
    expect(mockRelease).toHaveBeenCalledWith("ord1");
  });
});
