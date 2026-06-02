import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the supabase-server module before importing the SUT.
vi.mock("./supabase-server", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getSupabaseAdmin } from "./supabase-server";
import {
  claimIgFollowDiscount,
  getIgFollowDiscountStatus,
  consumeIgFollowDiscount,
} from "./ig-follow-discount";

const mockedAdmin = vi.mocked(getSupabaseAdmin);

function buildAdmin(handlers: {
  upsert?: ReturnType<typeof vi.fn>;
  selectMaybe?: ReturnType<typeof vi.fn>;
  rpc?: ReturnType<typeof vi.fn>;
}) {
  const eqMaybe = vi.fn().mockReturnValue({
    maybeSingle: handlers.selectMaybe ?? vi.fn().mockResolvedValue({ data: null, error: null }),
  });
  const select = vi.fn().mockReturnValue({ eq: eqMaybe });
  const upsert = handlers.upsert ?? vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn().mockReturnValue({ select, upsert });
  const rpc = handlers.rpc ?? vi.fn().mockResolvedValue({ data: [], error: null });
  return { from, rpc } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("claimIgFollowDiscount", () => {
  it("upserts and reports first-time claim", async () => {
    const upsert = vi.fn().mockResolvedValue({ data: [{ inserted: true }], error: null, count: 1 });
    mockedAdmin.mockReturnValue(buildAdmin({ upsert }));
    const result = await claimIgFollowDiscount("CUST_NEW");
    expect(result.alreadyClaimed).toBe(false);
    expect(upsert).toHaveBeenCalledWith(
      { customer_id: "CUST_NEW" },
      { onConflict: "customer_id", ignoreDuplicates: true, count: "exact" },
    );
  });

  it("reports alreadyClaimed when row exists (ignoreDuplicates returned 0 rows)", async () => {
    const upsert = vi.fn().mockResolvedValue({ data: [], error: null, count: 0 });
    mockedAdmin.mockReturnValue(buildAdmin({ upsert }));
    const result = await claimIgFollowDiscount("CUST_OLD");
    expect(result.alreadyClaimed).toBe(true);
  });

  it("returns alreadyClaimed=false on error so callers can retry on next request without UI lock", async () => {
    const upsert = vi.fn().mockResolvedValue({ data: null, error: new Error("db down") });
    mockedAdmin.mockReturnValue(buildAdmin({ upsert }));
    const result = await claimIgFollowDiscount("CUST_ERR");
    expect(result.alreadyClaimed).toBe(false);
  });
});

describe("getIgFollowDiscountStatus", () => {
  it("returns disabled shape when no row exists", async () => {
    const selectMaybe = vi.fn().mockResolvedValue({ data: null, error: null });
    mockedAdmin.mockReturnValue(buildAdmin({ selectMaybe }));
    const status = await getIgFollowDiscountStatus("CUST_NONE");
    expect(status).toEqual({
      available: false,
      percentage: 0,
      drinksRemaining: 0,
      claimedAt: null,
      redeemedAt: null,
    });
  });

  it("returns available=true with drinksRemaining when row is unredeemed", async () => {
    const selectMaybe = vi.fn().mockResolvedValue({
      data: {
        drinks_remaining: 1,
        percentage: 10,
        claimed_at: "2026-04-26T01:00:00Z",
        redeemed_at: null,
      },
      error: null,
    });
    mockedAdmin.mockReturnValue(buildAdmin({ selectMaybe }));
    const status = await getIgFollowDiscountStatus("CUST_HAS");
    expect(status.available).toBe(true);
    expect(status.drinksRemaining).toBe(1);
    expect(status.percentage).toBe(10);
    expect(status.redeemedAt).toBeNull();
  });

  it("returns disabled shape with redeemedAt when row is fully consumed", async () => {
    const selectMaybe = vi.fn().mockResolvedValue({
      data: {
        drinks_remaining: 0,
        percentage: 10,
        claimed_at: "2026-04-25T01:00:00Z",
        redeemed_at: "2026-04-26T01:00:00Z",
      },
      error: null,
    });
    mockedAdmin.mockReturnValue(buildAdmin({ selectMaybe }));
    const status = await getIgFollowDiscountStatus("CUST_USED");
    expect(status.available).toBe(false);
    expect(status.drinksRemaining).toBe(0);
    expect(status.redeemedAt).toBe("2026-04-26T01:00:00Z");
  });

  it("returns disabled shape on error so callers never throw", async () => {
    const selectMaybe = vi.fn().mockResolvedValue({ data: null, error: new Error("db") });
    mockedAdmin.mockReturnValue(buildAdmin({ selectMaybe }));
    const status = await getIgFollowDiscountStatus("CUST_ERR");
    expect(status.available).toBe(false);
  });
});

describe("consumeIgFollowDiscount", () => {
  it("returns RPC consumed_count + drinks_remaining", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ consumed_count: 1, drinks_remaining: 0 }],
      error: null,
    });
    mockedAdmin.mockReturnValue(buildAdmin({ rpc }));
    const result = await consumeIgFollowDiscount("CUST", "ORDER1", 1);
    expect(result).toEqual({ consumedCount: 1, drinksRemaining: 0 });
    expect(rpc).toHaveBeenCalledWith("consume_ig_follow_discount", {
      p_customer_id: "CUST",
      p_order_id: "ORDER1",
      p_count: 1,
    });
  });

  it("returns zeros when RPC errors so caller never crashes the payment route", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: new Error("rpc") });
    mockedAdmin.mockReturnValue(buildAdmin({ rpc }));
    const result = await consumeIgFollowDiscount("CUST", "ORDER1", 1);
    expect(result).toEqual({ consumedCount: 0, drinksRemaining: 0 });
  });
});
