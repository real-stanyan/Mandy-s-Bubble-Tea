import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getAuthedUser = vi.fn();
const search = vi.fn();
const getDeliveredOrderIds = vi.fn();

vi.mock("@/lib/auth", () => ({ getAuthedUser }));
vi.mock("@/lib/square", () => ({
  squareClient: { orders: { search } },
  SQUARE_LOCATION_ID: "test_location",
}));
// driver-tokens pulls in supabase-server at module scope, which wants env
// this test file deliberately runs without.
vi.mock("@/lib/driver-tokens", () => ({ getDeliveredOrderIds }));

const { lookupOrderStatusForChat } = await import("@/lib/chat/order-status");

const req = () => new Request("http://localhost/api/chat", { method: "POST" });

const USER = {
  userId: "u1",
  email: null,
  phone: null,
  profile: { square_customer_id: "CUST_1" },
};

/** An order placed now (Brisbane "today" by construction). */
function order(over: Record<string, unknown> = {}) {
  return {
    id: "ORDER_1",
    referenceId: "A17",
    createdAt: new Date().toISOString(),
    state: "OPEN",
    totalMoney: { amount: 750n },
    netAmountDueMoney: { amount: 0n },
    lineItems: [{ name: "Taro Milk Tea", quantity: "2", itemType: "ITEM" }],
    fulfillments: [{ type: "PICKUP", state: "PROPOSED" }],
    ...over,
  };
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  getAuthedUser.mockReset();
  getAuthedUser.mockResolvedValue(USER);
  search.mockReset();
  search.mockResolvedValue({ orders: [] });
  getDeliveredOrderIds.mockReset();
  getDeliveredOrderIds.mockResolvedValue(new Set());
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe("lookupOrderStatusForChat", () => {
  it("tells the model the customer is signed out — and never to claim readiness", async () => {
    getAuthedUser.mockResolvedValue(null);
    const lookup = await lookupOrderStatusForChat(req());
    expect(lookup.report).toContain("NOT signed in");
    expect(lookup.report).toContain("Do NOT claim the order is ready");
    // The flag the route turns into a sign-in card under the reply.
    expect(lookup.signedOut).toBe(true);
    expect(search).not.toHaveBeenCalled();
  });

  it("treats a profile without a Square customer id as signed out", async () => {
    getAuthedUser.mockResolvedValue({ ...USER, profile: null });
    const { report } = await lookupOrderStatusForChat(req());
    expect(report).toContain("NOT signed in");
    expect(search).not.toHaveBeenCalled();
  });

  it("says there are no orders today rather than inventing one", async () => {
    const { report } = await lookupOrderStatusForChat(req());
    expect(report).toContain("NO orders placed today");
    expect(report).toContain("Do not invent one");
  });

  it("lists recent past orders when today is empty, so history questions get real answers", async () => {
    // Stan's 3:31am test (2026-08-17): 17 past orders in My Orders, but the
    // report only spoke of "today", so Mandy answered "之前的订单" with
    // "查不到" twice. The search already fetched the history — surface it.
    const friday = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
    search.mockResolvedValue({
      orders: [
        order({ id: "PAST1", referenceId: "OL878", createdAt: friday }),
        // Unpaid and canceled history must stay invisible.
        order({ id: "PAST2", referenceId: "OL879", createdAt: friday, netAmountDueMoney: { amount: 500n } }),
        order({ id: "PAST3", referenceId: "OL880", createdAt: friday, state: "CANCELED" }),
      ],
    });
    const { report } = await lookupOrderStatusForChat(req());
    expect(report).toContain("NO orders placed today");
    expect(report).toContain("PAST orders");
    expect(report).toContain("Order #OL878");
    expect(report).toContain("My Orders page");
    expect(report).not.toContain("OL879");
    expect(report).not.toContain("OL880");
  });

  it("reports a PREPARED pickup order as READY with its reference and items", async () => {
    search.mockResolvedValue({
      orders: [order({ fulfillments: [{ type: "PICKUP", state: "PREPARED" }] })],
    });
    const lookup = await lookupOrderStatusForChat(req());
    // Signed-in paths must never trigger the sign-in card.
    expect(lookup.signedOut).toBe(false);
    const report = lookup.report;
    expect(report).toContain("Order #A17");
    expect(report).toContain("2x Taro Milk Tea");
    expect(report).toContain("READY — waiting at the counter");
    expect(report).toContain("holding policy");
  });

  it("reports an unfulfilled OPEN pickup order as still being made", async () => {
    search.mockResolvedValue({ orders: [order()] });
    const { report } = await lookupOrderStatusForChat(req());
    expect(report).toContain("still being made");
  });

  it("filters out yesterday's and unpaid orders", async () => {
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    search.mockResolvedValue({
      orders: [
        order({ id: "OLD", createdAt: yesterday }),
        // Abandoned cart: due > 0 — the paid filter must drop it, or Mandy
        // reports a "still being made" order the shop never saw.
        order({ id: "UNPAID", netAmountDueMoney: { amount: 750n } }),
      ],
    });
    const { report } = await lookupOrderStatusForChat(req());
    expect(report).toContain("NO orders placed today");
  });

  it("marks a delivery order delivered from the driver marks, not Square state", async () => {
    search.mockResolvedValue({
      orders: [
        order({
          fulfillments: [{ type: "DELIVERY", state: "PREPARED" }],
          metadata: { fulfillment_type: "DELIVERY" },
        }),
      ],
    });
    getDeliveredOrderIds.mockResolvedValue(new Set(["ORDER_1"]));
    const { report } = await lookupOrderStatusForChat(req());
    expect(report).toContain("DELIVERED");
    expect(getDeliveredOrderIds).toHaveBeenCalledWith(["ORDER_1"]);
  });

  it("degrades to an honest 'unavailable' when Square throws — never a 500, never a guess", async () => {
    search.mockRejectedValue(new Error("square down"));
    const { report } = await lookupOrderStatusForChat(req());
    expect(report).toContain("unavailable");
    expect(report).toContain("Do NOT claim the order is ready");
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
