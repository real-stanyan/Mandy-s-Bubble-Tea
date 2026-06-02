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
});
