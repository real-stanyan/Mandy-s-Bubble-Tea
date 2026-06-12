import { describe, it, expect, vi, beforeEach } from "vitest";

const mockOrdersGet = vi.fn();
const mockPaymentsCreate = vi.fn();
const mockOrdersPay = vi.fn();
const mockGetAuthedUser = vi.fn();
const mockFindOrCreateLoyaltyAccount = vi.fn();
const mockAccrueForOrder = vi.fn();
const mockConsumeWelcomeDiscount = vi.fn();
const mockConsumeIgFollowDiscount = vi.fn();
const mockConsumeToppingAllowance = vi.fn();
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
vi.mock("@/lib/tier-toppings-store", () => ({
  consumeToppingAllowance: (...args: unknown[]) =>
    mockConsumeToppingAllowance(...args),
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
const mockEnqueueCupLabelJobs = vi.fn();
vi.mock("@/lib/cup-label/enqueue", () => ({
  enqueueCupLabelJobs: (...args: unknown[]) =>
    mockEnqueueCupLabelJobs(...args),
}));

import { POST } from "./route";
import { brisbaneMonthKey } from "@/lib/membership-tier";

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/payment", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/payment — diamond tier-topping allowance consume", () => {
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
    mockFindOrCreateLoyaltyAccount.mockResolvedValue({ accountId: "acc1" });
    mockAccrueForOrder.mockResolvedValue(undefined);
    mockEnqueuePrintJob.mockResolvedValue({ queued: false, reason: "noop" });
    mockConsumeToppingAllowance.mockResolvedValue({ consumedCount: 3, usedCount: 3 });
  });

  it("calls consumeToppingAllowance with correct args on settled payment with tier-topping-allowance discount and metadata count 3", async () => {
    mockOrdersGet.mockResolvedValue({
      order: {
        id: "ord1",
        totalMoney: { amount: 600n },
        rewards: [],
        discounts: [{ uid: "tier-topping-allowance" }],
        metadata: { tierToppingsCovered: "3" },
      },
    });
    mockPaymentsCreate.mockResolvedValue({
      payment: { id: "pay1", status: "COMPLETED" },
    });

    const res = await POST(makeRequest({ orderId: "ord1", sourceId: "cnon:x" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(mockConsumeToppingAllowance).toHaveBeenCalledTimes(1);
    expect(mockConsumeToppingAllowance).toHaveBeenCalledWith(
      "cust1",
      brisbaneMonthKey(),
      3,
      "ord1",
    );
  });

  it("does NOT call consumeToppingAllowance when payment is NOT settled (status PENDING)", async () => {
    mockOrdersGet.mockResolvedValue({
      order: {
        id: "ord1",
        totalMoney: { amount: 600n },
        rewards: [],
        discounts: [{ uid: "tier-topping-allowance" }],
        metadata: { tierToppingsCovered: "3" },
      },
    });
    mockPaymentsCreate.mockResolvedValue({
      payment: { id: "pay1", status: "PENDING" },
    });

    const res = await POST(makeRequest({ orderId: "ord1", sourceId: "cnon:x" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe("PENDING");
    expect(mockConsumeToppingAllowance).not.toHaveBeenCalled();
  });

  it("does NOT call consumeToppingAllowance when payment settled but no tier-topping-allowance discount on order", async () => {
    mockOrdersGet.mockResolvedValue({
      order: {
        id: "ord1",
        totalMoney: { amount: 600n },
        rewards: [],
        discounts: [],
        metadata: { tierToppingsCovered: "3" },
      },
    });
    mockPaymentsCreate.mockResolvedValue({
      payment: { id: "pay1", status: "COMPLETED" },
    });

    await POST(makeRequest({ orderId: "ord1", sourceId: "cnon:x" }));

    expect(mockConsumeToppingAllowance).not.toHaveBeenCalled();
  });

  it("does NOT call consumeToppingAllowance when settled + discount present but metadata is garbage", async () => {
    mockOrdersGet.mockResolvedValue({
      order: {
        id: "ord1",
        totalMoney: { amount: 600n },
        rewards: [],
        discounts: [{ uid: "tier-topping-allowance" }],
        metadata: { tierToppingsCovered: "abc" },
      },
    });
    mockPaymentsCreate.mockResolvedValue({
      payment: { id: "pay1", status: "COMPLETED" },
    });

    await POST(makeRequest({ orderId: "ord1", sourceId: "cnon:x" }));

    expect(mockConsumeToppingAllowance).not.toHaveBeenCalled();
  });
});
