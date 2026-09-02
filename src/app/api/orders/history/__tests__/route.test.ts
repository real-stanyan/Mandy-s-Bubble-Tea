import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ getAuthedUser: vi.fn() }));
vi.mock("@/lib/square", () => ({
  squareClient: { orders: { search: vi.fn() } },
  SQUARE_LOCATION_ID: "LOC_TEST",
}));
vi.mock("@/lib/catalog", () => ({
  getMenu: vi.fn().mockResolvedValue({
    itemsBySlug: new Map(),
    uncategorizedItems: [],
    modifierLists: new Map(),
  }),
}));
vi.mock("@/lib/utils", async () => {
  const actual = await vi.importActual<typeof import("@/lib/utils")>(
    "@/lib/utils",
  );
  return actual;
});

import { getAuthedUser } from "@/lib/auth";
import { squareClient } from "@/lib/square";
import { GET } from "../route";

const mockedGetAuthed = vi.mocked(getAuthedUser);
const mockedOrdersSearch = vi.mocked(squareClient.orders.search);

function makeReq() {
  return new Request("http://localhost/api/orders/history");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/orders/history", () => {
  it("returns 401 when caller has no Supabase session", async () => {
    mockedGetAuthed.mockResolvedValue(null);
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({
      ok: false,
      error: "Sign in to see your order history",
    });
    expect(mockedOrdersSearch).not.toHaveBeenCalled();
  });

  // Regression for Kevin Jiang 2026-05-08 21:53 BNE: account page renders
  // AccountHeader (profile loaded by /api/me) AND a "Sign in to see your
  // order history" pill at the same time. Root cause: caller is authed
  // but their profile/square_customer_id isn't available in the brief
  // window between complete-signup write and the next read. Returning
  // 401 there leaves a sticky misleading error pill on the screen.
  // Expected behaviour: hand back an empty orders array — there are
  // legitimately no orders yet for a user who just signed up.
  it("returns 200 with empty orders for authed user without profile", async () => {
    mockedGetAuthed.mockResolvedValue({
      userId: "u1",
      email: null,
      phone: null,
      profile: null,
    } as never);
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, orders: [] });
    expect(mockedOrdersSearch).not.toHaveBeenCalled();
  });

  it("returns 200 with empty orders for authed user whose profile lacks a square_customer_id", async () => {
    mockedGetAuthed.mockResolvedValue({
      userId: "u1",
      email: null,
      phone: "+61400000000",
      profile: {
        user_id: "u1",
        square_customer_id: null,
        phone_e164: "+61400000000",
        first_name: "Test",
        last_name: null,
        square_verified_at: null,
      },
    } as never);
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, orders: [] });
    expect(mockedOrdersSearch).not.toHaveBeenCalled();
  });

  it("queries Square and returns orders for authed user with square_customer_id", async () => {
    mockedGetAuthed.mockResolvedValue({
      userId: "u1",
      email: null,
      phone: "+61400000000",
      profile: {
        user_id: "u1",
        square_customer_id: "CUST_KEVIN",
        phone_e164: "+61400000000",
        first_name: "Kevin",
        last_name: "j",
        square_verified_at: null,
      },
    } as never);
    mockedOrdersSearch.mockResolvedValue({
      orders: [
        {
          id: "ORDER_1",
          state: "COMPLETED",
          totalMoney: { amount: 1004n, currency: "AUD" },
          netAmountDueMoney: { amount: 0n, currency: "AUD" },
          lineItems: [{ name: "Original Milk Tea", quantity: "2" }],
          fulfillments: [{ type: "PICKUP", state: "COMPLETED" }],
          createdAt: "2026-05-08T11:53:10.501Z",
        },
      ],
    } as never);
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.orders).toHaveLength(1);
    expect(body.orders[0].id).toBe("ORDER_1");
    expect(mockedOrdersSearch).toHaveBeenCalledOnce();
  });

  it("keeps a pre-accept delivery order visible: AUTHORIZED hold, due > 0, placed today", async () => {
    // Delivery cards are authorized at checkout and captured on driver
    // accept, so before accept due > 0. The 2026-08-23 complaint: a charged
    // customer opened My Orders and saw nothing.
    mockedGetAuthed.mockResolvedValue({
      userId: "u1",
      email: null,
      phone: "+61400000000",
      profile: {
        user_id: "u1",
        square_customer_id: "CUST_KEVIN",
        phone_e164: "+61400000000",
        first_name: "Kevin",
        last_name: "j",
        square_verified_at: null,
      },
    } as never);
    mockedOrdersSearch.mockResolvedValue({
      orders: [
        {
          id: "ORDER_HELD",
          state: "OPEN",
          totalMoney: { amount: 2255n, currency: "AUD" },
          netAmountDueMoney: { amount: 2255n, currency: "AUD" },
          tenders: [{ cardDetails: { status: "AUTHORIZED" } }],
          lineItems: [{ name: "Taro Milk Tea", quantity: "2" }],
          fulfillments: [{ type: "PICKUP", state: "PROPOSED" }],
          metadata: { fulfillment_type: "DELIVERY" },
          createdAt: new Date().toISOString(),
        },
        {
          // Same hold but from a past day: an authorization that never
          // captured must not linger in history as if the order happened.
          id: "ORDER_STALE_HOLD",
          state: "OPEN",
          totalMoney: { amount: 900n, currency: "AUD" },
          netAmountDueMoney: { amount: 900n, currency: "AUD" },
          tenders: [{ cardDetails: { status: "AUTHORIZED" } }],
          lineItems: [{ name: "Original Milk Tea", quantity: "1" }],
          fulfillments: [{ type: "PICKUP", state: "PROPOSED" }],
          metadata: { fulfillment_type: "DELIVERY" },
          createdAt: "2026-05-08T11:53:10.501Z",
        },
      ],
    } as never);
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.orders).toHaveLength(1);
    expect(body.orders[0].id).toBe("ORDER_HELD");
    expect(body.orders[0].active).toBe(true);
  });

  it("keeps a driver-declined delivery visible as CANCELED (hold VOIDED, fulfillment CANCELED, order still OPEN)", async () => {
    // DE852 (2026-09-02): the driver tapped Decline → hold voided, fulfillment
    // CANCELED, but Square left the order OPEN with due > 0. The paid filter
    // read that as an abandoned cart and the order vanished from Your Orders.
    mockedGetAuthed.mockResolvedValue({
      userId: "u1",
      email: null,
      phone: "+61400000000",
      profile: {
        user_id: "u1",
        square_customer_id: "CUST_STAN",
        phone_e164: "+61400000000",
        first_name: "Stan",
        last_name: "y",
        square_verified_at: null,
      },
    } as never);
    mockedOrdersSearch.mockResolvedValue({
      orders: [
        {
          id: "ORDER_DECLINED",
          referenceId: "DE852",
          state: "OPEN",
          totalMoney: { amount: 2087n, currency: "AUD" },
          netAmountDueMoney: { amount: 2087n, currency: "AUD" },
          tenders: [{ cardDetails: { status: "VOIDED" } }],
          lineItems: [{ name: "Brown Sugar Milk Tea", quantity: "1" }],
          fulfillments: [{ type: "PICKUP", state: "CANCELED" }],
          metadata: { fulfillment_type: "DELIVERY" },
          createdAt: new Date().toISOString(),
        },
      ],
    } as never);
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.orders).toHaveLength(1);
    expect(body.orders[0].id).toBe("ORDER_DECLINED");
    expect(body.orders[0].state).toBe("CANCELED");
    expect(body.orders[0].fulfillmentState).toBe("CANCELED");
    expect(body.orders[0].active).toBe(false);
  });
});
