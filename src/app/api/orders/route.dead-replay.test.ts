import { describe, it, expect, vi, beforeEach } from "vitest";

// Dead idempotent replay (DE888, 2026-09-06). Square answers a CreateOrder
// whose idempotency key it has seen before with the ORIGINAL order — even one
// that has since been CANCELED. The clients keep their key stable across Pay
// retries on purpose, so the route must notice a dead replay and create a
// fresh order under a key chained off the dead id.

const { ordersCreate, ordersSearch } = vi.hoisted(() => ({
  ordersCreate: vi.fn(),
  ordersSearch: vi.fn(),
}));
vi.mock("@/lib/square", () => ({
  SQUARE_LOCATION_ID: "L1",
  squareClient: {
    orders: { create: ordersCreate, search: ordersSearch },
  },
}));
vi.mock("@/lib/auth", () => ({
  getAuthedUser: vi.fn(),
}));
vi.mock("@/lib/store-status-server", () => ({
  getEffectiveOrderingStatus: vi.fn(),
  isDeliveryEnabled: vi.fn(),
}));
vi.mock("@/lib/catalog", () => ({
  // Reject → priceMaps null → discount/tier branches skipped; the create
  // call runs regardless.
  getMenu: vi.fn().mockRejectedValue(new Error("menu unavailable in test")),
}));
vi.mock("@/lib/supabase", () => ({
  nextOnlineOrderNumber: vi.fn().mockResolvedValue("OL800"),
  nextScheduledOrderNumber: vi.fn().mockResolvedValue("OL700"),
  getWelcomeDiscountStatus: vi.fn(),
}));
vi.mock("@/lib/ig-follow-discount", () => ({
  getIgFollowDiscountStatus: vi.fn(),
}));
vi.mock("@/lib/loyalty", () => ({
  findLoyaltyAccountByPhone: vi.fn(),
}));

import { POST } from "./route";
import { getAuthedUser } from "@/lib/auth";
import { getEffectiveOrderingStatus } from "@/lib/store-status-server";
import { deriveOrderIdempotencyKey } from "@/lib/order-idempotency";

const BODY = {
  lines: [
    { variationId: "VAR1", variationPriceCents: 600, quantity: 1, modifiers: [] },
  ],
  fulfillmentType: "PICKUP",
  idempotencyKey: "nonce-1",
};

function orderRequest(): Request {
  return new Request("http://test/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(BODY),
  });
}

const FRESH = {
  id: "fresh1",
  state: "OPEN",
  referenceId: "OL800",
  ticketName: "OL800",
  totalMoney: { amount: 600n, currency: "AUD" },
};

describe("POST /api/orders — dead idempotent replay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthedUser).mockResolvedValue({
      profile: { square_customer_id: "C1", phone_e164: "+61400000000" },
    } as Awaited<ReturnType<typeof getAuthedUser>>);
    vi.mocked(getEffectiveOrderingStatus).mockResolvedValue({
      open: true,
      nextLabel: "until 10:15pm",
    });
    ordersSearch.mockResolvedValue({ orders: [] });
  });

  it("creates a fresh order when the replay hands back a CANCELED one", async () => {
    ordersCreate
      .mockResolvedValueOnce({
        order: { id: "dead1", state: "CANCELED", ticketName: "DE888" },
      })
      .mockResolvedValueOnce({ order: FRESH });

    const res = await POST(orderRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.orderId).toBe("fresh1");
    expect(json.amountCents).toBe("600");

    expect(ordersCreate).toHaveBeenCalledTimes(2);
    const [first, second] = ordersCreate.mock.calls.map((c) => c[0]);
    expect(first.idempotencyKey).toBe(deriveOrderIdempotencyKey("C1", "nonce-1"));
    // Chained off the dead id — deterministic, so the customer's next retry
    // replays THIS fresh order rather than minting a third.
    expect(second.idempotencyKey).toBe(
      deriveOrderIdempotencyKey("C1", "nonce-1|after:dead1"),
    );
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
    // Same draft both times: same lines, same allocated number.
    expect(second.order).toEqual(first.order);
  });

  it("stops chaining after two dead hops and returns what Square gave", async () => {
    ordersCreate
      .mockResolvedValueOnce({ order: { id: "dead1", state: "CANCELED" } })
      .mockResolvedValueOnce({ order: { id: "dead2", state: "CANCELED" } })
      .mockResolvedValueOnce({ order: { id: "dead3", state: "CANCELED" } });

    const res = await POST(orderRequest());
    const json = await res.json();
    expect(ordersCreate).toHaveBeenCalledTimes(3);
    expect(ordersCreate.mock.calls[2][0].idempotencyKey).toBe(
      deriveOrderIdempotencyKey("C1", "nonce-1|after:dead2"),
    );
    // Handed on as-is; /api/payment then answers 409 orderNotOpen rather
    // than touching the card.
    expect(json.orderId).toBe("dead3");
  });

  it("leaves a live OPEN replay alone (the intended retry-dedupe)", async () => {
    ordersCreate.mockResolvedValueOnce({ order: FRESH });

    const res = await POST(orderRequest());
    const json = await res.json();
    expect(json.orderId).toBe("fresh1");
    expect(ordersCreate).toHaveBeenCalledTimes(1);
  });

  it("returns a COMPLETED replay as-is (paid retry → alreadyPaid downstream)", async () => {
    ordersCreate.mockResolvedValueOnce({
      order: { ...FRESH, id: "paid1", state: "COMPLETED" },
    });

    const res = await POST(orderRequest());
    const json = await res.json();
    expect(json.orderId).toBe("paid1");
    expect(ordersCreate).toHaveBeenCalledTimes(1);
  });
});
