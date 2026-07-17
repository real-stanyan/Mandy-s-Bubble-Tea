import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the supabase-server module before importing the SUT.
vi.mock("./supabase-server", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getSupabaseAdmin } from "./supabase-server";
import {
  getActiveFlashPromo,
  getFlashPromoStatus,
  consumeFlashPromo,
  flashPromoKeyFromDiscounts,
  flashPromoUid,
} from "./flash-promo";

const mockedAdmin = vi.mocked(getSupabaseAdmin);

// Brisbane 2026-07-17 mid-afternoon (UTC+10).
const NOW = new Date("2026-07-17T05:00:00Z");

/**
 * Table-keyed mock: `.from(table)` returns a chain whose terminal
 * `.maybeSingle()` resolves the handler for that table. `.eq()` chains.
 */
function buildAdmin(handlers: {
  promos?: ReturnType<typeof vi.fn>;
  redemptions?: ReturnType<typeof vi.fn>;
  rpc?: ReturnType<typeof vi.fn>;
}) {
  const from = vi.fn((table: string) => {
    const maybeSingle =
      table === "flash_promos"
        ? (handlers.promos ?? vi.fn().mockResolvedValue({ data: null, error: null }))
        : (handlers.redemptions ?? vi.fn().mockResolvedValue({ data: null, error: null }));
    const chain = { eq: vi.fn(), maybeSingle };
    chain.eq.mockReturnValue(chain);
    return { select: vi.fn().mockReturnValue(chain) };
  });
  const rpc = handlers.rpc ?? vi.fn().mockResolvedValue({ data: [], error: null });
  return { from, rpc } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("flashPromoUid", () => {
  it("round-trips through flashPromoKeyFromDiscounts", () => {
    expect(
      flashPromoKeyFromDiscounts([{ uid: flashPromoUid("flash-2026-07-17") }]),
    ).toBe("flash-2026-07-17");
  });

  it("only contains characters Square order uids accept", () => {
    // Square 400-rejects any other character (a colon separator took down
    // every flash order on 2026-07-17). Pin the whole-uid charset.
    expect(flashPromoUid("flash-2026-07-17")).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});

describe("flashPromoKeyFromDiscounts", () => {
  it("parses the key out of a flash-promo uid", () => {
    expect(
      flashPromoKeyFromDiscounts([
        { uid: "welcome-discount" },
        { uid: "flash-promo.flash-2026-07-17" },
      ]),
    ).toBe("flash-2026-07-17");
  });

  it("returns null when no flash discount is present", () => {
    expect(flashPromoKeyFromDiscounts([{ uid: "tier-discount" }])).toBeNull();
    expect(flashPromoKeyFromDiscounts(undefined)).toBeNull();
    expect(flashPromoKeyFromDiscounts([])).toBeNull();
  });

  it("returns null for a bare prefix with no key", () => {
    expect(flashPromoKeyFromDiscounts([{ uid: "flash-promo." }])).toBeNull();
  });
});

describe("getActiveFlashPromo", () => {
  it("returns the promo row for today's Brisbane date", async () => {
    const promos = vi.fn().mockResolvedValue({
      data: { key: "flash-2026-07-17", percentage: 20 },
      error: null,
    });
    mockedAdmin.mockReturnValue(buildAdmin({ promos }));
    const status = await getActiveFlashPromo(NOW);
    expect(status).toEqual({
      available: true,
      key: "flash-2026-07-17",
      percentage: 20,
    });
  });

  it("returns disabled when no promo row matches today", async () => {
    mockedAdmin.mockReturnValue(buildAdmin({}));
    const status = await getActiveFlashPromo(NOW);
    expect(status).toEqual({ available: false, key: null, percentage: 0 });
  });

  it("returns disabled on query error (never blocks checkout)", async () => {
    const promos = vi.fn().mockResolvedValue({ data: null, error: new Error("db down") });
    mockedAdmin.mockReturnValue(buildAdmin({ promos }));
    const status = await getActiveFlashPromo(NOW);
    expect(status.available).toBe(false);
  });
});

describe("getFlashPromoStatus", () => {
  const activePromo = vi.fn().mockResolvedValue({
    data: { key: "flash-2026-07-17", percentage: 20 },
    error: null,
  });

  it("available when promo active and customer has no redemption", async () => {
    const redemptions = vi.fn().mockResolvedValue({ data: null, error: null });
    mockedAdmin.mockReturnValue(buildAdmin({ promos: activePromo, redemptions }));
    const status = await getFlashPromoStatus("CUST_1", NOW);
    expect(status).toEqual({
      available: true,
      key: "flash-2026-07-17",
      percentage: 20,
    });
  });

  it("disabled once the customer has redeemed", async () => {
    const redemptions = vi.fn().mockResolvedValue({
      data: { customer_id: "CUST_1" },
      error: null,
    });
    mockedAdmin.mockReturnValue(buildAdmin({ promos: activePromo, redemptions }));
    const status = await getFlashPromoStatus("CUST_1", NOW);
    expect(status.available).toBe(false);
  });

  it("disabled when no promo is active today", async () => {
    mockedAdmin.mockReturnValue(buildAdmin({}));
    const status = await getFlashPromoStatus("CUST_1", NOW);
    expect(status.available).toBe(false);
  });

  it("disabled on redemption lookup error (fail safe for merchant)", async () => {
    const redemptions = vi.fn().mockResolvedValue({ data: null, error: new Error("db down") });
    mockedAdmin.mockReturnValue(buildAdmin({ promos: activePromo, redemptions }));
    const status = await getFlashPromoStatus("CUST_1", NOW);
    expect(status.available).toBe(false);
  });
});

describe("consumeFlashPromo", () => {
  it("reports consumedCount=1 on first burn", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ consumed_count: 1 }], error: null });
    mockedAdmin.mockReturnValue(buildAdmin({ rpc }));
    const result = await consumeFlashPromo("flash-2026-07-17", "CUST_1", "ORDER_1");
    expect(result.consumedCount).toBe(1);
    expect(rpc).toHaveBeenCalledWith("consume_flash_promo", {
      p_promo_key: "flash-2026-07-17",
      p_customer_id: "CUST_1",
      p_order_id: "ORDER_1",
    });
  });

  it("reports consumedCount=0 on duplicate burn", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ consumed_count: 0 }], error: null });
    mockedAdmin.mockReturnValue(buildAdmin({ rpc }));
    const result = await consumeFlashPromo("flash-2026-07-17", "CUST_1", "ORDER_2");
    expect(result.consumedCount).toBe(0);
  });

  it("swallows RPC errors as consumedCount=0", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: new Error("db down") });
    mockedAdmin.mockReturnValue(buildAdmin({ rpc }));
    const result = await consumeFlashPromo("flash-2026-07-17", "CUST_1", "ORDER_3");
    expect(result.consumedCount).toBe(0);
  });
});
