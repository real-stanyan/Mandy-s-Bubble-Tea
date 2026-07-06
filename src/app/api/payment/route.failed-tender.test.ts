import { describe, it, expect, vi, beforeEach } from "vitest";

// OL807 (2026-07-06): a DECLINED card (INSUFFICIENT_FUNDS) leaves a
// FAILED tender on the still-OPEN order. Two bugs followed:
//   1. The alreadyPaid guard counted the dead tender as payment, so the
//      customer's retry got a fake `alreadyPaid` success and the client
//      navigated to the confirmation page ("Preparing your order") for
//      an order that was never paid.
//   2. If payments.create resolves with status FAILED instead of
//      throwing, the route still answered ok:true.
// These tests pin the fixes. Mock scaffolding mirrors
// route.already-paid.test.ts.

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

describe("POST /api/payment — FAILED tender must not count as payment (OL807)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthedUser.mockResolvedValue({
      userId: "u1",
      profile: {
        square_customer_id: "cust1",
        phone_e164: "+61400000001",
        first_name: "Makayla",
      },
    });
    mockEnqueuePrintJob.mockResolvedValue({ queued: false, reason: "noop" });
  });

  it("OPEN order whose only tender FAILED → retry charges the card (no fake alreadyPaid)", async () => {
    mockOrdersGet.mockResolvedValue({
      order: {
        id: "ord_ol807",
        state: "OPEN",
        totalMoney: { amount: 501n },
        tenders: [
          {
            id: "t1",
            type: "CARD",
            cardDetails: {
              status: "FAILED",
              errors: [{ code: "INSUFFICIENT_FUNDS" }],
            },
          },
        ],
        rewards: [],
        discounts: [],
        metadata: {},
      },
    });
    mockPaymentsCreate.mockResolvedValue({
      payment: { id: "pay_retry", status: "COMPLETED" },
    });
    mockFindOrCreateLoyaltyAccount.mockResolvedValue({ accountId: "acc1" });
    mockAccrueForOrder.mockResolvedValue(undefined);

    const res = await POST(
      makeRequest({ orderId: "ord_ol807", sourceId: "cnon:new-card" }),
    );
    const json = await res.json();

    expect(json.alreadyPaid).toBeUndefined();
    expect(mockPaymentsCreate).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.status).toBe("COMPLETED");
  });

  it("OPEN order with an AUTHORIZED tender (delivery hold) → still alreadyPaid, no re-charge", async () => {
    // Thomas-guard regression: a live hold must keep short-circuiting.
    mockOrdersGet.mockResolvedValue({
      order: {
        id: "ord_hold",
        state: "OPEN",
        totalMoney: { amount: 1250n },
        tenders: [
          { id: "t1", type: "CARD", cardDetails: { status: "AUTHORIZED" } },
        ],
        rewards: [],
        discounts: [],
        metadata: { fulfillment_type: "DELIVERY" },
      },
    });

    const res = await POST(
      makeRequest({ orderId: "ord_hold", sourceId: "cnon:x" }),
    );
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(json.alreadyPaid).toBe(true);
    expect(mockPaymentsCreate).not.toHaveBeenCalled();
  });

  it("payments.create resolves with status FAILED (non-throwing) → ok:false, no side effects", async () => {
    mockOrdersGet.mockResolvedValue({
      order: {
        id: "ord_fail",
        state: "OPEN",
        totalMoney: { amount: 501n },
        tenders: [],
        rewards: [],
        discounts: [{ uid: "welcome-discount" }],
        metadata: { welcomeDiscountDrinksCovered: "1" },
      },
    });
    mockPaymentsCreate.mockResolvedValue({
      payment: { id: "pay_declined", status: "FAILED" },
    });

    const res = await POST(
      makeRequest({ orderId: "ord_fail", sourceId: "cnon:bad-card" }),
    );
    const json = await res.json();

    expect(json.ok).toBe(false);
    expect(res.status).toBe(402);
    expect(json.error).toBeTruthy();
    // A failed charge must not mint stars or burn discounts.
    expect(mockAccrueForOrder).not.toHaveBeenCalled();
    expect(mockConsumeWelcomeDiscount).not.toHaveBeenCalled();
  });
});
