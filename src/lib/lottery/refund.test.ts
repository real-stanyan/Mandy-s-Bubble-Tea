import { describe, expect, it, vi } from "vitest";
import { handleRefundedOrder } from "./refund";

describe("handleRefundedOrder", () => {
  it("voids the prize_roll for a fully-refunded order", async () => {
    const deps = {
      getOrderTotalCents: vi.fn().mockResolvedValue(1000),
      getCumulativeRefundCents: vi.fn().mockResolvedValue(1000),
      voidPrizeRoll: vi.fn().mockResolvedValue({ updated: 1 }),
    };
    const result = await handleRefundedOrder("sq-order-1", deps);
    expect(result.voided).toBe(true);
    expect(deps.voidPrizeRoll).toHaveBeenCalledWith("sq-order-1");
  });

  it("does not void on partial refund", async () => {
    const deps = {
      getOrderTotalCents: vi.fn().mockResolvedValue(1000),
      getCumulativeRefundCents: vi.fn().mockResolvedValue(500),
      voidPrizeRoll: vi.fn(),
    };
    const result = await handleRefundedOrder("sq-order-1", deps);
    expect(result.voided).toBe(false);
    expect(deps.voidPrizeRoll).not.toHaveBeenCalled();
  });

  it("treats refund cents == total cents as full refund", async () => {
    const deps = {
      getOrderTotalCents: vi.fn().mockResolvedValue(789),
      getCumulativeRefundCents: vi.fn().mockResolvedValue(789),
      voidPrizeRoll: vi.fn().mockResolvedValue({ updated: 1 }),
    };
    const result = await handleRefundedOrder("sq", deps);
    expect(result.voided).toBe(true);
  });

  it("handles refund cents > total (rare rounding) as full refund", async () => {
    const deps = {
      getOrderTotalCents: vi.fn().mockResolvedValue(789),
      getCumulativeRefundCents: vi.fn().mockResolvedValue(800),
      voidPrizeRoll: vi.fn().mockResolvedValue({ updated: 1 }),
    };
    const result = await handleRefundedOrder("sq", deps);
    expect(result.voided).toBe(true);
  });

  it("returns voided=false when no prize_roll was matched (e.g., already voided)", async () => {
    const deps = {
      getOrderTotalCents: vi.fn().mockResolvedValue(1000),
      getCumulativeRefundCents: vi.fn().mockResolvedValue(1000),
      voidPrizeRoll: vi.fn().mockResolvedValue({ updated: 0 }),
    };
    const result = await handleRefundedOrder("sq", deps);
    expect(result.voided).toBe(false);
  });

  it("does not throw if order lookup returns null total", async () => {
    const deps = {
      getOrderTotalCents: vi.fn().mockResolvedValue(null),
      getCumulativeRefundCents: vi.fn().mockResolvedValue(500),
      voidPrizeRoll: vi.fn(),
    };
    const result = await handleRefundedOrder("sq", deps);
    expect(result.voided).toBe(false);
  });
});
