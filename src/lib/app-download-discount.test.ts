import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the supabase-server module before importing the SUT.
vi.mock("./supabase-server", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getSupabaseAdmin } from "./supabase-server";
import {
  claimAppDownloadDiscount,
  getAppDownloadDiscountStatus,
  consumeAppDownloadDiscount,
  appDownloadPhoneFromOrder,
} from "./app-download-discount";
import type { Square } from "square";

const mockedAdmin = vi.mocked(getSupabaseAdmin);

function buildAdmin(handlers: {
  upsert?: ReturnType<typeof vi.fn>;
  selectMaybe?: ReturnType<typeof vi.fn>;
  rpc?: ReturnType<typeof vi.fn>;
}) {
  const eqMaybe = vi.fn().mockReturnValue({
    maybeSingle:
      handlers.selectMaybe ??
      vi.fn().mockResolvedValue({ data: null, error: null }),
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

describe("claimAppDownloadDiscount", () => {
  it("upserts by phone and reports first-time claim", async () => {
    const upsert = vi
      .fn()
      .mockResolvedValue({ data: [{ inserted: true }], error: null, count: 1 });
    mockedAdmin.mockReturnValue(buildAdmin({ upsert }));
    const result = await claimAppDownloadDiscount("+61400000001");
    expect(result.alreadyClaimed).toBe(false);
    expect(upsert).toHaveBeenCalledWith(
      { phone_e164: "+61400000001" },
      { onConflict: "phone_e164", ignoreDuplicates: true, count: "exact" },
    );
  });

  it("reports alreadyClaimed when the phone already has a row", async () => {
    const upsert = vi
      .fn()
      .mockResolvedValue({ data: [], error: null, count: 0 });
    mockedAdmin.mockReturnValue(buildAdmin({ upsert }));
    const result = await claimAppDownloadDiscount("+61400000002");
    expect(result.alreadyClaimed).toBe(true);
  });

  it("returns alreadyClaimed=false on error so the caller can retry", async () => {
    const upsert = vi
      .fn()
      .mockResolvedValue({ data: null, error: new Error("db down") });
    mockedAdmin.mockReturnValue(buildAdmin({ upsert }));
    const result = await claimAppDownloadDiscount("+61400000003");
    expect(result.alreadyClaimed).toBe(false);
  });
});

describe("getAppDownloadDiscountStatus", () => {
  it("returns disabled shape when no row exists", async () => {
    const selectMaybe = vi.fn().mockResolvedValue({ data: null, error: null });
    mockedAdmin.mockReturnValue(buildAdmin({ selectMaybe }));
    const status = await getAppDownloadDiscountStatus("+61400000009");
    expect(status).toEqual({
      available: false,
      percentage: 0,
      claimedAt: null,
      redeemedAt: null,
    });
  });

  it("returns available=true when the ticket is unredeemed", async () => {
    const selectMaybe = vi.fn().mockResolvedValue({
      data: {
        percentage: 20,
        claimed_at: "2026-07-24T01:00:00Z",
        redeemed_at: null,
      },
      error: null,
    });
    mockedAdmin.mockReturnValue(buildAdmin({ selectMaybe }));
    const status = await getAppDownloadDiscountStatus("+61400000010");
    expect(status.available).toBe(true);
    expect(status.percentage).toBe(20);
    expect(status.redeemedAt).toBeNull();
  });

  it("returns available=false once redeemed", async () => {
    const selectMaybe = vi.fn().mockResolvedValue({
      data: {
        percentage: 20,
        claimed_at: "2026-07-23T01:00:00Z",
        redeemed_at: "2026-07-24T01:00:00Z",
      },
      error: null,
    });
    mockedAdmin.mockReturnValue(buildAdmin({ selectMaybe }));
    const status = await getAppDownloadDiscountStatus("+61400000011");
    expect(status.available).toBe(false);
    expect(status.redeemedAt).toBe("2026-07-24T01:00:00Z");
  });

  it("returns disabled shape on error so callers never throw", async () => {
    const selectMaybe = vi
      .fn()
      .mockResolvedValue({ data: null, error: new Error("db") });
    mockedAdmin.mockReturnValue(buildAdmin({ selectMaybe }));
    const status = await getAppDownloadDiscountStatus("+61400000012");
    expect(status.available).toBe(false);
  });
});

describe("consumeAppDownloadDiscount", () => {
  it("returns consumed_count=1 on the call that burns the ticket", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: [{ consumed_count: 1 }], error: null });
    mockedAdmin.mockReturnValue(buildAdmin({ rpc }));
    const result = await consumeAppDownloadDiscount(
      "+61400000020",
      "ORDER1",
      "CUST1",
    );
    expect(result).toEqual({ consumedCount: 1 });
    expect(rpc).toHaveBeenCalledWith("consume_app_download_discount", {
      p_phone: "+61400000020",
      p_order_id: "ORDER1",
      p_customer_id: "CUST1",
    });
  });

  it("returns consumed_count=0 on a replayed burn (already redeemed)", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: [{ consumed_count: 0 }], error: null });
    mockedAdmin.mockReturnValue(buildAdmin({ rpc }));
    const result = await consumeAppDownloadDiscount(
      "+61400000021",
      "ORDER2",
      null,
    );
    expect(result).toEqual({ consumedCount: 0 });
  });

  it("returns zero when the RPC errors so the payment route never crashes", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: new Error("rpc") });
    mockedAdmin.mockReturnValue(buildAdmin({ rpc }));
    const result = await consumeAppDownloadDiscount(
      "+61400000022",
      "ORDER3",
      "CUST3",
    );
    expect(result).toEqual({ consumedCount: 0 });
  });
});

describe("appDownloadPhoneFromOrder", () => {
  it("reads the recipient phone off the PICKUP fulfillment", () => {
    const order = {
      fulfillments: [
        { pickupDetails: { recipient: { phoneNumber: "+61400000030" } } },
      ],
    } as unknown as Square.Order;
    expect(appDownloadPhoneFromOrder(order)).toBe("+61400000030");
  });

  it("returns null when no fulfillment phone is present", () => {
    const order = { fulfillments: [] } as unknown as Square.Order;
    expect(appDownloadPhoneFromOrder(order)).toBeNull();
  });
});
