import { describe, it, expect, vi, beforeEach } from "vitest";

// alreadyPaid guard — three states (Thomas bug, 2026-07): a paid-but-OPEN
// order (tender present) used to slip past the COMPLETED-only check and
// re-enter payments.create, double-authorizing the customer's card.

const mockOrdersGet = vi.fn();
const mockPaymentsCreate = vi.fn();
const mockOrdersPay = vi.fn();
const mockGetAuthedUser = vi.fn();
const mockFindOrCreateLoyaltyAccount = vi.fn();
const mockAccrueForOrder = vi.fn();
const mockConsumeWelcomeDiscount = vi.fn();
const mockConsumeIgFollowDiscount = vi.fn();
const mockEnqueuePrintJob = vi.fn();
const mockNotifyOwnersPrinterAlert = vi.fn();

vi.mock("@/lib/square", () => ({
  SQUARE_LOCATION_ID: "loc_test",
  squareClient: {
    orders: {
      get: (args: unknown) => mockOrdersGet(args),
      pay: (args: unknown) => mockOrdersPay(args),
    },
    payments: { create: (args: unknown) => mockPaymentsCreate(args) },
  },
}));
vi.mock("@/lib/auth", () => ({
  getAuthedUser: (req: Request) => mockGetAuthedUser(req),
}));
vi.mock("@/lib/loyalty", () => ({
  findOrCreateLoyaltyAccount: (...args: unknown[]) =>
    mockFindOrCreateLoyaltyAccount(...args),
  accrueForOrder: (...args: unknown[]) => mockAccrueForOrder(...args),
}));
vi.mock("@/lib/supabase", () => ({
  consumeWelcomeDiscount: (...args: unknown[]) =>
    mockConsumeWelcomeDiscount(...args),
}));
vi.mock("@/lib/ig-follow-discount", () => ({
  consumeIgFollowDiscount: (...args: unknown[]) =>
    mockConsumeIgFollowDiscount(...args),
}));
vi.mock("@/lib/print-jobs", () => ({
  enqueuePrintJob: (...args: unknown[]) => mockEnqueuePrintJob(...args),
}));
vi.mock("@/lib/printer-alert", () => ({
  notifyOwnersPrinterAlert: (...args: unknown[]) =>
    mockNotifyOwnersPrinterAlert(...args),
}));
const mockAfter = vi.fn((cb: () => unknown) => {
  void cb();
});
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (cb: () => unknown) => mockAfter(cb),
}));
vi.mock("@/lib/cup-label/enqueue", () => ({
  enqueueCupLabelJobs: vi.fn(),
}));
vi.mock("@/lib/driver-notify", () => ({
  notifyDriversNewDelivery: vi.fn(),
}));

import { POST } from "./route";

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/payment", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/payment — alreadyPaid guard (COMPLETED OR tender present)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthedUser.mockResolvedValue({
      userId: "u1",
      profile: {
        square_customer_id: "cust1",
        phone_e164: "+61400000001",
        first_name: "Thomas",
      },
    });
    mockEnqueuePrintJob.mockResolvedValue({ queued: false, reason: "noop" });
  });

  it("COMPLETED order → alreadyPaid, no charge", async () => {
    mockOrdersGet.mockResolvedValue({
      order: {
        id: "ord1",
        state: "COMPLETED",
        totalMoney: { amount: 600n },
        tenders: [{ id: "t1" }],
        rewards: [],
        discounts: [],
        metadata: {},
      },
    });

    const res = await POST(makeRequest({ orderId: "ord1", sourceId: "cnon:x" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.alreadyPaid).toBe(true);
    expect(mockPaymentsCreate).not.toHaveBeenCalled();
  });

  it("OPEN order WITH a tender (paid / delivery pre-auth) → alreadyPaid, no second authorization", async () => {
    // Thomas case: card already authorized (tender exists) but the order is
    // still OPEN. The old COMPLETED-only guard re-authorized + voided ×2.
    mockOrdersGet.mockResolvedValue({
      order: {
        id: "ord2",
        state: "OPEN",
        totalMoney: { amount: 1250n },
        tenders: [{ id: "t1", type: "CARD" }],
        rewards: [],
        discounts: [],
        metadata: { fulfillment_type: "DELIVERY" },
      },
    });

    const res = await POST(makeRequest({ orderId: "ord2", sourceId: "cnon:x" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.alreadyPaid).toBe(true);
    expect(mockPaymentsCreate).not.toHaveBeenCalled();
    // No side effects re-run either.
    expect(mockAccrueForOrder).not.toHaveBeenCalled();
    expect(mockConsumeWelcomeDiscount).not.toHaveBeenCalled();
  });

  it("OPEN order with NO tender → proceeds to payments.create as normal", async () => {
    mockOrdersGet.mockResolvedValue({
      order: {
        id: "ord3",
        state: "OPEN",
        totalMoney: { amount: 600n },
        tenders: [],
        rewards: [],
        discounts: [],
        metadata: {},
      },
    });
    mockPaymentsCreate.mockResolvedValue({
      payment: { id: "pay1", status: "COMPLETED" },
    });
    mockFindOrCreateLoyaltyAccount.mockResolvedValue({ accountId: "acc1" });
    mockAccrueForOrder.mockResolvedValue(undefined);

    const res = await POST(makeRequest({ orderId: "ord3", sourceId: "cnon:x" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.alreadyPaid).toBeUndefined();
    expect(mockPaymentsCreate).toHaveBeenCalledTimes(1);
  });

  it("OPEN order with tenders: undefined (older API shape) → still proceeds", async () => {
    mockOrdersGet.mockResolvedValue({
      order: {
        id: "ord4",
        state: "OPEN",
        totalMoney: { amount: 600n },
        rewards: [],
        discounts: [],
        metadata: {},
      },
    });
    mockPaymentsCreate.mockResolvedValue({
      payment: { id: "pay2", status: "COMPLETED" },
    });
    mockFindOrCreateLoyaltyAccount.mockResolvedValue({ accountId: "acc1" });

    const res = await POST(makeRequest({ orderId: "ord4", sourceId: "cnon:x" }));
    const json = await res.json();

    expect(json.alreadyPaid).toBeUndefined();
    expect(mockPaymentsCreate).toHaveBeenCalledTimes(1);
  });
});
