import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase-server before importing the SUT.
vi.mock("./supabase-server", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getSupabaseAdmin } from "./supabase-server";
import {
  getToppingAllowanceStatus,
  consumeToppingAllowance,
} from "./tier-toppings-store";

const mockedAdmin = vi.mocked(getSupabaseAdmin);

function buildAdmin(handlers: {
  selectMaybe?: ReturnType<typeof vi.fn>;
  rpc?: ReturnType<typeof vi.fn>;
}) {
  const maybeSingle =
    handlers.selectMaybe ?? vi.fn().mockResolvedValue({ data: null, error: null });
  const eq2 = vi.fn().mockReturnValue({ maybeSingle });
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
  const select = vi.fn().mockReturnValue({ eq: eq1 });
  const from = vi.fn().mockReturnValue({ select });
  const rpc = handlers.rpc ?? vi.fn().mockResolvedValue({ data: [], error: null });
  return { from, rpc } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getToppingAllowanceStatus", () => {
  it("no row (maybeSingle → data null) → usedCount 0, remaining 10", async () => {
    const selectMaybe = vi.fn().mockResolvedValue({ data: null, error: null });
    mockedAdmin.mockReturnValue(buildAdmin({ selectMaybe }));
    const result = await getToppingAllowanceStatus("CUST1", "2026-06");
    expect(result).toEqual({ usedCount: 0, remaining: 10, monthKey: "2026-06" });
  });

  it("row with used_count 7 → usedCount 7, remaining 3", async () => {
    const selectMaybe = vi.fn().mockResolvedValue({
      data: { used_count: 7 },
      error: null,
    });
    mockedAdmin.mockReturnValue(buildAdmin({ selectMaybe }));
    const result = await getToppingAllowanceStatus("CUST1", "2026-06");
    expect(result).toEqual({ usedCount: 7, remaining: 3, monthKey: "2026-06" });
  });

  it("query error → remaining 0, never throws", async () => {
    const selectMaybe = vi.fn().mockResolvedValue({
      data: null,
      error: new Error("db down"),
    });
    mockedAdmin.mockReturnValue(buildAdmin({ selectMaybe }));
    const result = await getToppingAllowanceStatus("CUST1", "2026-06");
    expect(result).toEqual({ usedCount: 0, remaining: 0, monthKey: "2026-06" });
  });
});

describe("consumeToppingAllowance", () => {
  it("RPC returns [{consumed_count: 3, used_count: 5}] → correct shape and rpc called with right params", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: [{ consumed_count: 3, used_count: 5 }], error: null });
    mockedAdmin.mockReturnValue(buildAdmin({ rpc }));
    const result = await consumeToppingAllowance("CUST1", "2026-06", 3, "ORDER1");
    expect(result).toEqual({ consumedCount: 3, usedCount: 5 });
    expect(rpc).toHaveBeenCalledWith("consume_topping_allowance", {
      p_customer_id: "CUST1",
      p_month_key: "2026-06",
      p_count: 3,
      p_order_id: "ORDER1",
    });
  });

  it("RPC error → {consumedCount: 0, usedCount: 0}, never throws", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: new Error("rpc fail") });
    mockedAdmin.mockReturnValue(buildAdmin({ rpc }));
    const result = await consumeToppingAllowance("CUST1", "2026-06", 3, "ORDER1");
    expect(result).toEqual({ consumedCount: 0, usedCount: 0 });
  });
});
