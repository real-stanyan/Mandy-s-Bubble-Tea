import { describe, it, expect, vi, beforeEach } from "vitest";

// Dead-order guard (DE888, 2026-09-06). A CANCELED order can never be paid:
// Square rejects payments.create with "The order must be OPEN to be paid." —
// but only AFTER authorizing the card, which it then voids. Five retries in
// five minutes = five authorize-and-void cycles on one customer's debit card.
// The route must answer before the card is touched.

const mockOrdersGet = vi.fn();
const mockPaymentsCreate = vi.fn();
const mockOrdersPay = vi.fn();
const mockGetAuthedUser = vi.fn();

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
  findOrCreateLoyaltyAccount: vi.fn(),
  accrueForOrder: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  consumeWelcomeDiscount: vi.fn(),
}));
vi.mock("@/lib/ig-follow-discount", () => ({
  consumeIgFollowDiscount: vi.fn(),
}));
vi.mock("@/lib/print-jobs", () => ({
  enqueuePrintJob: vi.fn(),
}));
vi.mock("@/lib/printer-alert", () => ({
  notifyOwnersPrinterAlert: vi.fn(),
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (cb: () => unknown) => void cb(),
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

describe("POST /api/payment — dead order (not OPEN) is refused before the card", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthedUser.mockResolvedValue({
      userId: "u1",
      profile: {
        square_customer_id: "cust1",
        phone_e164: "+61400000001",
        first_name: "Dee",
      },
    });
  });

  it("CANCELED order with no tender (swept abandoned cart) → 409 orderNotOpen, no charge", async () => {
    mockOrdersGet.mockResolvedValue({
      order: {
        id: "DE888",
        state: "CANCELED",
        totalMoney: { amount: 2573n },
        netAmountDueMoney: { amount: 2573n },
        tenders: [],
        rewards: [],
        discounts: [],
        metadata: { fulfillment_type: "DELIVERY" },
      },
    });

    const res = await POST(makeRequest({ orderId: "DE888", sourceId: "cnon:apple" }));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.ok).toBe(false);
    expect(json.orderNotOpen).toBe(true);
    expect(json.orderState).toBe("CANCELED");
    expect(json.error).toMatch(/no longer open/i);
    expect(mockPaymentsCreate).not.toHaveBeenCalled();
    expect(mockOrdersPay).not.toHaveBeenCalled();
  });

  it("CANCELED order whose hold was VOIDED (released delivery) → 409, no re-authorization", async () => {
    mockOrdersGet.mockResolvedValue({
      order: {
        id: "DE852",
        state: "CANCELED",
        totalMoney: { amount: 1900n },
        tenders: [{ id: "t1", type: "CARD", cardDetails: { status: "VOIDED" } }],
        rewards: [],
        discounts: [],
        metadata: { fulfillment_type: "DELIVERY" },
      },
    });

    const res = await POST(makeRequest({ orderId: "DE852", sourceId: "cnon:x" }));
    expect(res.status).toBe(409);
    expect((await res.json()).orderNotOpen).toBe(true);
    expect(mockPaymentsCreate).not.toHaveBeenCalled();
  });

  it("DRAFT order → 409 as well", async () => {
    mockOrdersGet.mockResolvedValue({
      order: { id: "d1", state: "DRAFT", totalMoney: { amount: 600n }, tenders: [] },
    });
    const res = await POST(makeRequest({ orderId: "d1", sourceId: "cnon:x" }));
    expect(res.status).toBe(409);
    expect(mockPaymentsCreate).not.toHaveBeenCalled();
  });

  it("a $0 CANCELED order is refused too — orders.pay would fail the same way", async () => {
    mockOrdersGet.mockResolvedValue({
      order: { id: "z1", state: "CANCELED", totalMoney: { amount: 0n }, tenders: [], rewards: [{ id: "r1" }] },
    });
    const res = await POST(makeRequest({ orderId: "z1" }));
    expect(res.status).toBe(409);
    expect(mockOrdersPay).not.toHaveBeenCalled();
  });
});
