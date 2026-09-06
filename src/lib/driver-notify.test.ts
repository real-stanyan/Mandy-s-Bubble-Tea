import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Square } from "square";

// notifyDriversNewDelivery is called from the webhook on EVERY order.updated.
// DE888 (2026-09-06): the cancel of a never-paid delivery cart pushed
// "New delivery 🚚" to both drivers. Only a settled order — card held/charged,
// or fully comped — may reach them, unless the payment route vouches for a
// hold it has just placed (assumeSettled).

const mockClaim = vi.fn();
const mockTokens = vi.fn();
const mockPush = vi.fn();

vi.mock("@/lib/push-tokens", () => ({
  claimOrderPushSlot: (...a: unknown[]) => mockClaim(...a),
}));
vi.mock("@/lib/driver-tokens", () => ({
  getAllDriverPushTokens: (...a: unknown[]) => mockTokens(...a),
}));
vi.mock("@/lib/push", () => ({
  sendExpoPush: (...a: unknown[]) => mockPush(...a),
}));

import { notifyDriversNewDelivery } from "./driver-notify";

const base = {
  id: "O1",
  referenceId: "DE900",
  metadata: { fulfillment_type: "DELIVERY", delivery_address: "1 Test St" },
};
const asOrder = (o: unknown) => o as Square.Order;

describe("notifyDriversNewDelivery — settlement gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClaim.mockResolvedValue(true);
    mockTokens.mockResolvedValue(["ExponentPushToken[a]", "ExponentPushToken[b]"]);
    mockPush.mockResolvedValue(2);
  });

  it("skips a never-paid cart (due > 0, no tender) — nothing claimed, nothing sent", async () => {
    await notifyDriversNewDelivery(
      asOrder({
        ...base,
        state: "OPEN",
        totalMoney: { amount: 2573n },
        netAmountDueMoney: { amount: 2573n },
        tenders: [],
      }),
    );
    expect(mockClaim).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("skips a CANCELED order even when its hold was once real (now VOIDED)", async () => {
    await notifyDriversNewDelivery(
      asOrder({
        ...base,
        state: "CANCELED",
        totalMoney: { amount: 2573n },
        netAmountDueMoney: { amount: 2573n },
        tenders: [{ id: "t1", cardDetails: { status: "VOIDED" } }],
      }),
      "evt-1",
    );
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("pushes for an AUTHORIZED hold (the webhook fallback path)", async () => {
    await notifyDriversNewDelivery(
      asOrder({
        ...base,
        state: "OPEN",
        totalMoney: { amount: 2573n },
        netAmountDueMoney: { amount: 2573n },
        tenders: [{ id: "t1", cardDetails: { status: "AUTHORIZED" } }],
      }),
      "evt-2",
    );
    expect(mockClaim).toHaveBeenCalledWith("O1", "new_delivery");
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it("pushes for a $0 comped delivery (due 0, no tender)", async () => {
    await notifyDriversNewDelivery(
      asOrder({
        ...base,
        state: "OPEN",
        totalMoney: { amount: 0n },
        netAmountDueMoney: { amount: 0n },
        tenders: [],
        rewards: [{ id: "r1" }],
      }),
    );
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it("assumeSettled lets the payment route push with its pre-payment order object", async () => {
    await notifyDriversNewDelivery(
      asOrder({
        ...base,
        state: "OPEN",
        totalMoney: { amount: 2573n },
        netAmountDueMoney: { amount: 2573n },
        tenders: [],
      }),
      undefined,
      { assumeSettled: true },
    );
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it("still ignores non-delivery orders", async () => {
    await notifyDriversNewDelivery(
      asOrder({ ...base, metadata: {}, state: "OPEN", totalMoney: { amount: 0n }, tenders: [] }),
      undefined,
      { assumeSettled: true },
    );
    expect(mockPush).not.toHaveBeenCalled();
  });
});
