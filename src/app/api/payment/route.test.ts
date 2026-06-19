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
// after() must be the registration point for the cup-label enqueue — a bare
// fire-and-forget promise dies when Vercel freezes the lambda post-response
// (OL826 2026-06-06). The mock runs the callback inline so the test can
// assert the enqueue actually went through it.
const mockAfter = vi.fn((cb: () => unknown) => {
  void cb();
});
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (cb: () => unknown) => mockAfter(cb),
}));
const mockEnqueueCupLabelJobs = vi.fn();
vi.mock("@/lib/cup-label/enqueue", () => ({
  enqueueCupLabelJobs: (...args: unknown[]) =>
    mockEnqueueCupLabelJobs(...args),
}));
const mockNotifyDrivers = vi.fn();
vi.mock("@/lib/driver-notify", () => ({
  notifyDriversNewDelivery: (...args: unknown[]) => mockNotifyDrivers(...args),
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

describe("POST /api/payment — $0 delivery defers to the driver flow (DE833 fix)", () => {
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
    mockNotifyDrivers.mockResolvedValue(undefined);
    mockEnqueuePrintJob.mockResolvedValue({ queued: false, reason: "noop" });
  });

  it("does NOT settle a $0 delivery order (no orders.pay) and advertises it to drivers", async () => {
    mockOrdersGet.mockResolvedValue({
      order: {
        id: "ordD",
        totalMoney: { amount: 0n },
        rewards: [{ id: "r1" }],
        discounts: [],
        metadata: { fulfillment_type: "DELIVERY" },
      },
    });

    const res = await POST(makeRequest({ orderId: "ordD" }));
    expect(res.status).toBe(200);
    // The DE833 bug: orders.pay completed the order pre-acceptance. Must NOT run.
    expect(mockOrdersPay).not.toHaveBeenCalled();
    // Drivers are told so one can accept it.
    expect(mockNotifyDrivers).toHaveBeenCalled();
    // Print is deferred to driver accept (no settle, no webhook for a $0 order).
    expect(mockEnqueuePrintJob).not.toHaveBeenCalled();
  });

  it("still settles a $0 PICKUP order via orders.pay (unchanged)", async () => {
    mockOrdersGet.mockResolvedValue({
      order: {
        id: "ordP",
        totalMoney: { amount: 0n },
        rewards: [{ id: "r1" }],
        discounts: [],
        metadata: {},
      },
    });
    mockOrdersPay.mockResolvedValue({ order: { id: "ordP", state: "COMPLETED" } });

    const res = await POST(makeRequest({ orderId: "ordP" }));
    expect(res.status).toBe(200);
    expect(mockOrdersPay).toHaveBeenCalled();
    expect(mockNotifyDrivers).not.toHaveBeenCalled();
  });
});

describe("POST /api/payment — already-paid idempotency guard (replay → no double charge)", () => {
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
  });

  it("does NOT re-charge or re-consume a discount when the order is already COMPLETED", async () => {
    mockOrdersGet.mockResolvedValue({
      order: {
        id: "ord1",
        state: "COMPLETED",
        totalMoney: { amount: 600n },
        // Gross total still shows; a replayed POST must not act on it.
        discounts: [{ uid: "welcome-discount" }],
        metadata: { welcomeDiscountDrinksCovered: "1" },
        rewards: [],
      },
    });

    const res = await POST(makeRequest({ orderId: "ord1", sourceId: "cnon:x" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.alreadyPaid).toBe(true);
    // The whole point: no second charge, no discount re-consume, no accrual.
    expect(mockPaymentsCreate).not.toHaveBeenCalled();
    expect(mockOrdersPay).not.toHaveBeenCalled();
    expect(mockConsumeWelcomeDiscount).not.toHaveBeenCalled();
    expect(mockAccrueForOrder).not.toHaveBeenCalled();
  });

  it("still charges a fresh (OPEN) order normally", async () => {
    mockOrdersGet.mockResolvedValue({
      order: {
        id: "ord1",
        state: "OPEN",
        totalMoney: { amount: 600n },
        discounts: [],
        metadata: {},
        rewards: [],
      },
    });
    mockPaymentsCreate.mockResolvedValue({
      payment: { id: "pay1", status: "COMPLETED" },
    });
    mockEnqueuePrintJob.mockResolvedValue({ queued: false, reason: "noop" });
    mockFindOrCreateLoyaltyAccount.mockResolvedValue({ accountId: "acc1" });
    mockAccrueForOrder.mockResolvedValue(undefined);

    const res = await POST(makeRequest({ orderId: "ord1", sourceId: "cnon:x" }));
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(mockPaymentsCreate).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/payment — cup-label enqueue survives the response (bug OL826 2026-06-06)", () => {
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
    mockFindOrCreateLoyaltyAccount.mockResolvedValue({ accountId: "acc1" });
    mockAccrueForOrder.mockResolvedValue(undefined);
  });

  it("registers the user-choice enqueue via after(), not a bare promise", async () => {
    mockPaymentsCreate.mockResolvedValue({
      payment: { id: "pay1", status: "COMPLETED" },
    });
    mockEnqueuePrintJob.mockResolvedValue({
      queued: true,
      stickerNumber: "OL826",
    });

    const res = await POST(
      makeRequest({
        orderId: "ord1",
        sourceId: "cnon:x",
        presetStickerHashes: { "line1:0": "abc123" },
      }),
    );

    expect(res.status).toBe(200);
    expect(mockAfter).toHaveBeenCalledTimes(1);
    // The after() callback (run inline by the mock) must invoke the enqueue
    // with the user's selections intact.
    await vi.waitFor(() => {
      expect(mockEnqueueCupLabelJobs).toHaveBeenCalledWith(
        expect.objectContaining({
          stickerNumber: "OL826",
          presetStickerHashes: { "line1:0": "abc123" },
        }),
      );
    });
  });

  it("skips the cup-label branch entirely when the user made no label choice", async () => {
    mockPaymentsCreate.mockResolvedValue({
      payment: { id: "pay1", status: "COMPLETED" },
    });
    mockEnqueuePrintJob.mockResolvedValue({
      queued: true,
      stickerNumber: "OL827",
    });

    await POST(makeRequest({ orderId: "ord1", sourceId: "cnon:x" }));

    expect(mockAfter).not.toHaveBeenCalled();
    expect(mockEnqueueCupLabelJobs).not.toHaveBeenCalled();
  });
});


describe("POST /api/payment — keepsake copies (keepLabelCopy)", () => {
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
    mockFindOrCreateLoyaltyAccount.mockResolvedValue({ accountId: "acc1" });
    mockAccrueForOrder.mockResolvedValue(undefined);
  });

  it("passes includeKeepsakeCopies:true to enqueue when keepLabelCopy is set", async () => {
    mockPaymentsCreate.mockResolvedValue({
      payment: { id: "pay1", status: "COMPLETED" },
    });
    mockEnqueuePrintJob.mockResolvedValue({ queued: true, stickerNumber: "OL930" });

    await POST(
      makeRequest({
        orderId: "ord1",
        sourceId: "cnon:x",
        presetStickerHashes: { "line1:0": "abc123" },
        keepLabelCopy: true,
      }),
    );

    await vi.waitFor(() => {
      expect(mockEnqueueCupLabelJobs).toHaveBeenCalledWith(
        expect.objectContaining({ includeKeepsakeCopies: true }),
      );
    });
  });

  it("passes includeKeepsakeCopies:false when keepLabelCopy is absent", async () => {
    mockPaymentsCreate.mockResolvedValue({
      payment: { id: "pay1", status: "COMPLETED" },
    });
    mockEnqueuePrintJob.mockResolvedValue({ queued: true, stickerNumber: "OL931" });

    await POST(
      makeRequest({
        orderId: "ord1",
        sourceId: "cnon:x",
        presetStickerHashes: { "line1:0": "abc123" },
      }),
    );

    await vi.waitFor(() => {
      expect(mockEnqueueCupLabelJobs).toHaveBeenCalledWith(
        expect.objectContaining({ includeKeepsakeCopies: false }),
      );
    });
  });
});
