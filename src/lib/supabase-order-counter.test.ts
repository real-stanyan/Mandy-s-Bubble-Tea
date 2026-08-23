import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseAdmin: () => ({ rpc }),
}));

const { nextScheduledOrderNumber } = await import("@/lib/supabase");

describe("nextScheduledOrderNumber", () => {
  beforeEach(() => rpc.mockReset());

  it("returns the OL7xx number from its own counter", async () => {
    rpc.mockResolvedValue({ data: "OL700", error: null });
    expect(await nextScheduledOrderNumber()).toBe("OL700");
    expect(rpc).toHaveBeenCalledWith("next_scheduled_order_number");
  });

  it("returns null past OL799 — the series would collide with real ASAP numbers", async () => {
    rpc.mockResolvedValue({ data: "OL800", error: null });
    expect(await nextScheduledOrderNumber()).toBeNull();
  });

  it("throws on an RPC error (missing migration included) so the route falls back", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "function does not exist" } });
    await expect(nextScheduledOrderNumber()).rejects.toThrow("scheduled counter failed");
  });
});
