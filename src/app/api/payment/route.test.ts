import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { POST } from "./route";

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/payment", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/payment — loyalty accrual gating (bug `loyalty-payment-not-gated-2026-05-18`)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthedUser.mockResolvedValue({
      userId: "u1",
      profile: {
        square_customer_id: "cust1",
        phone_e164: "+61400000001",
        first_name: "Stan",
      },
    });
    mockOrdersGet.mockResolvedValue({
      order: {
        id: "ord1",
        totalMoney: { amount: 600n },
        rewards: [],
        discounts: [],
        metadata: {},
      },
    });
    mockEnqueuePrintJob.mockResolvedValue({ queued: false, reason: "noop" });
  });

  it("does NOT accrue stars when Square payment returns PENDING (no throw)", async () => {
    mockPaymentsCreate.mockResolvedValue({
      payment: { id: "pay1", status: "PENDING" },
    });

    const res = await POST(makeRequest({ orderId: "ord1", sourceId: "cnon:x" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.status).toBe("PENDING");
    expect(json.loyaltyAccrued).toBe(false);
    expect(mockFindOrCreateLoyaltyAccount).not.toHaveBeenCalled();
    expect(mockAccrueForOrder).not.toHaveBeenCalled();
  });

  it("does NOT accrue stars when Square payment returns FAILED (no throw)", async () => {
    mockPaymentsCreate.mockResolvedValue({
      payment: { id: "pay2", status: "FAILED" },
    });

    const res = await POST(makeRequest({ orderId: "ord1", sourceId: "cnon:x" }));
    const json = await res.json();

    expect(json.loyaltyAccrued).toBe(false);
    expect(mockAccrueForOrder).not.toHaveBeenCalled();
  });

  it("DOES accrue stars when Square payment returns COMPLETED", async () => {
    mockPaymentsCreate.mockResolvedValue({
      payment: { id: "pay3", status: "COMPLETED" },
    });
    mockFindOrCreateLoyaltyAccount.mockResolvedValue({ accountId: "acc1" });
    mockAccrueForOrder.mockResolvedValue(undefined);

    const res = await POST(makeRequest({ orderId: "ord1", sourceId: "cnon:x" }));
    const json = await res.json();

    expect(json.loyaltyAccrued).toBe(true);
    expect(mockAccrueForOrder).toHaveBeenCalledWith("acc1", "ord1");
  });

  it("DOES accrue stars on $0 loyalty-reward orders (partial reward path)", async () => {
    // $0 total with a partial reward (rewards array empty in this synthetic
    // case to bypass skipAccrual — paymentSettled should still be true for
    // a $0 order even though paymentStatus stays null).
    mockOrdersGet.mockResolvedValue({
      order: {
        id: "ord1",
        totalMoney: { amount: 0n },
        rewards: [],
        discounts: [],
        metadata: {},
      },
    });
    mockOrdersPay.mockResolvedValue({
      order: { id: "ord1", state: "COMPLETED" },
    });
    mockFindOrCreateLoyaltyAccount.mockResolvedValue({ accountId: "acc1" });
    mockAccrueForOrder.mockResolvedValue(undefined);

    const res = await POST(makeRequest({ orderId: "ord1" }));
    const json = await res.json();

    expect(json.loyaltyAccrued).toBe(true);
    expect(mockAccrueForOrder).toHaveBeenCalledWith("acc1", "ord1");
  });
});
