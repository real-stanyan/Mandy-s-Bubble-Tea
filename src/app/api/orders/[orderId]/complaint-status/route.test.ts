import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getAuthedUser: vi.fn() }));
vi.mock("@/lib/square", () => ({
  squareClient: { orders: { get: vi.fn() } },
}));
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { GET } from "./route";
import { getAuthedUser } from "@/lib/auth";
import { squareClient } from "@/lib/square";
import { getSupabaseAdmin } from "@/lib/supabase-server";

const completedOrder = {
  id: "ord_abc",
  state: "COMPLETED",
  customerId: "CUST_OWN",
  closedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
};

function mockReq(orderId = "ord_abc") {
  return {
    request: new Request(`http://test/api/orders/${orderId}/complaint-status`),
    context: { params: Promise.resolve({ orderId }) },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

function mockSupabaseRow(row: { created_at: string } | null) {
  const single = vi.fn().mockResolvedValue({ data: row, error: null });
  const eq = vi.fn().mockReturnValue({ maybeSingle: single });
  const select = vi.fn().mockReturnValue({ eq });
  (getSupabaseAdmin as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    from: vi.fn().mockReturnValue({ select }),
  });
}

describe("GET complaint-status", () => {
  it("401 when no session", async () => {
    (getAuthedUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const { request, context } = mockReq();
    const res = await GET(request, context);
    expect(res.status).toBe(401);
  });

  it("eligible when COMPLETED + within 7 days + own order + no row", async () => {
    (getAuthedUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: "u1",
      profile: { square_customer_id: "CUST_OWN" },
    });
    (squareClient.orders.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      order: completedOrder,
    });
    mockSupabaseRow(null);
    const { request, context } = mockReq();
    const res = await GET(request, context);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.reason).toBe("eligible");
  });

  it("returns already_reported when row exists", async () => {
    (getAuthedUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: "u1",
      profile: { square_customer_id: "CUST_OWN" },
    });
    (squareClient.orders.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      order: completedOrder,
    });
    mockSupabaseRow({ created_at: "2026-04-25T00:00:00Z" });
    const { request, context } = mockReq();
    const res = await GET(request, context);
    const json = await res.json();
    expect(json.reason).toBe("already_reported");
    expect(json.alreadyReportedAt).toBe("2026-04-25T00:00:00Z");
  });

  it("returns window_closed when closedAt > 7 days", async () => {
    (getAuthedUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: "u1",
      profile: { square_customer_id: "CUST_OWN" },
    });
    (squareClient.orders.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      order: {
        ...completedOrder,
        closedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      },
    });
    mockSupabaseRow(null);
    const { request, context } = mockReq();
    const res = await GET(request, context);
    const json = await res.json();
    expect(json.reason).toBe("window_closed");
  });

  it("returns not_completed for OPEN orders", async () => {
    (getAuthedUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: "u1",
      profile: { square_customer_id: "CUST_OWN" },
    });
    (squareClient.orders.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      order: { ...completedOrder, state: "OPEN", closedAt: null },
    });
    mockSupabaseRow(null);
    const { request, context } = mockReq();
    const res = await GET(request, context);
    const json = await res.json();
    expect(json.reason).toBe("not_completed");
  });

  it("403 when order belongs to another customer", async () => {
    (getAuthedUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      userId: "u1",
      profile: { square_customer_id: "CUST_OTHER" },
    });
    (squareClient.orders.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      order: completedOrder,
    });
    mockSupabaseRow(null);
    const { request, context } = mockReq();
    const res = await GET(request, context);
    expect(res.status).toBe(403);
  });
});
