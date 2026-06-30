import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock just enough to reach the delivery-toggle gate. Everything heavier
// (Square order creation, pricing, loyalty) lives AFTER the gate, so the
// 409 path never touches it.
const { ordersCreate } = vi.hoisted(() => ({ ordersCreate: vi.fn() }));
vi.mock("@/lib/square", () => ({
  SQUARE_LOCATION_ID: "L1",
  squareClient: { orders: { create: ordersCreate } },
}));
vi.mock("@/lib/auth", () => ({
  getAuthedUser: vi.fn(),
}));
vi.mock("@/lib/store-status-server", () => ({
  getEffectiveOrderingStatus: vi.fn(),
  isDeliveryEnabled: vi.fn(),
}));
vi.mock("@/lib/catalog", () => ({
  // Throw so priceMaps falls back to null (cache-outage path) — the gate runs
  // regardless of pricing.
  getMenu: vi.fn().mockRejectedValue(new Error("menu unavailable in test")),
}));

import { POST } from "./route";
import { getAuthedUser } from "@/lib/auth";
import {
  getEffectiveOrderingStatus,
  isDeliveryEnabled,
} from "@/lib/store-status-server";

function orderRequest(body: unknown): Request {
  return new Request("http://test/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const DELIVERY_BODY = {
  lines: [
    { variationId: "VAR1", variationPriceCents: 600, quantity: 1, modifiers: [] },
  ],
  fulfillmentType: "DELIVERY",
  delivery: {
    address: "34 Davenport St, Southport",
    lat: -27.96,
    lng: 153.41,
    postcode: "4215",
  },
};

describe("POST /api/orders — delivery toggle gate", () => {
  beforeEach(() => {
    ordersCreate.mockReset();
    vi.mocked(getAuthedUser).mockReset();
    vi.mocked(getEffectiveOrderingStatus).mockReset();
    vi.mocked(isDeliveryEnabled).mockReset();
    vi.mocked(getAuthedUser).mockResolvedValue({
      profile: { square_customer_id: "C1", phone_e164: "+61400000000" },
    } as Awaited<ReturnType<typeof getAuthedUser>>);
    vi.mocked(getEffectiveOrderingStatus).mockResolvedValue({
      open: true,
      nextLabel: "until 10:30pm",
    });
  });

  it("delivery switched OFF → 409 deliveryDisabled, no Square order created", async () => {
    vi.mocked(isDeliveryEnabled).mockResolvedValue(false);
    const res = await POST(orderRequest(DELIVERY_BODY));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.deliveryDisabled).toBe(true);
    expect(ordersCreate).not.toHaveBeenCalled();
  });

  it("delivery ON → gate passes (proceeds past the toggle check)", async () => {
    vi.mocked(isDeliveryEnabled).mockResolvedValue(true);
    const res = await POST(orderRequest(DELIVERY_BODY));
    // Past the gate: it no longer returns the deliveryDisabled 409. (It may
    // later reject for hours/zone/eligibility — that's fine; we only assert the
    // toggle gate itself let it through.)
    const json = await res.json().catch(() => ({}));
    expect(json.deliveryDisabled).toBeUndefined();
  });
});
