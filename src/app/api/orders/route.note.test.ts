// The checkout note for the barista rides on every Square line item (the
// cup label reads it back from there) as well as in the pickup note.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { ordersCreate, ordersSearch } = vi.hoisted(() => ({
  ordersCreate: vi.fn(),
  ordersSearch: vi.fn(),
}));
vi.mock("@/lib/square", () => ({
  SQUARE_LOCATION_ID: "L1",
  squareClient: { orders: { create: ordersCreate, search: ordersSearch } },
}));
vi.mock("@/lib/auth", () => ({
  getAuthedUser: vi.fn(),
}));
vi.mock("@/lib/store-status-server", () => ({
  getEffectiveOrderingStatus: vi.fn(),
  isDeliveryEnabled: vi.fn(),
}));
vi.mock("@/lib/catalog", () => ({
  getMenu: vi.fn().mockRejectedValue(new Error("menu unavailable in test")),
}));
vi.mock("@/lib/supabase", () => ({
  nextOnlineOrderNumber: vi.fn().mockResolvedValue("DE999"),
  nextScheduledOrderNumber: vi.fn().mockResolvedValue("OL700"),
  getWelcomeDiscountStatus: vi.fn(),
}));
vi.mock("@/lib/delivery-hours", () => ({
  isDeliveryHoursOpen: vi.fn().mockReturnValue(true),
}));
vi.mock("@/lib/holiday", () => ({
  getActivePublicHoliday: vi.fn().mockReturnValue(null),
}));

import { POST } from "./route";
import { getAuthedUser } from "@/lib/auth";
import { getEffectiveOrderingStatus, isDeliveryEnabled } from "@/lib/store-status-server";

function orderRequest(body: unknown): Request {
  return new Request("http://test/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const pickupBody = (over: Record<string, unknown> = {}) => ({
  fulfillmentType: "PICKUP",
  lines: [
    { itemName: "Taro Milk Tea", variationId: "VAR1", variationPriceCents: 600, quantity: 1, modifiers: [] },
    { itemName: "Pearl Milk Tea", variationId: "VAR2", variationPriceCents: 650, quantity: 2, modifiers: [] },
  ],
  ...over,
});

const createdOrder = () => ordersCreate.mock.calls[0][0].order;

beforeEach(() => {
  ordersCreate.mockReset();
  ordersSearch.mockReset();
  ordersSearch.mockResolvedValue({ orders: [] });
  ordersCreate.mockResolvedValue({ order: { id: "ORD1", totalMoney: { amount: 1900n } } });
  vi.mocked(getAuthedUser).mockReset();
  vi.mocked(getAuthedUser).mockResolvedValue({
    profile: { square_customer_id: "C1", phone_e164: "+61400000000" },
  } as Awaited<ReturnType<typeof getAuthedUser>>);
  vi.mocked(getEffectiveOrderingStatus).mockResolvedValue({ open: true, nextLabel: "until 10:30pm" });
  vi.mocked(isDeliveryEnabled).mockResolvedValue(true);
});

describe("POST /api/orders — customer note on line items", () => {
  it("stamps the (normalised) note onto every line item and keeps it in the pickup note", async () => {
    const res = await POST(orderRequest(pickupBody({ note: "  no ice \n please  " })));
    expect((await res.json()).ok).toBe(true);
    const order = createdOrder();
    expect(order.lineItems).toHaveLength(2);
    for (const line of order.lineItems) expect(line.note).toBe("no ice please");
    expect(order.fulfillments[0].pickupDetails.note).toBe("DE999 — no ice please");
  });

  it("leaves line items note-free when the customer typed nothing", async () => {
    const res = await POST(orderRequest(pickupBody({ note: "   " })));
    expect((await res.json()).ok).toBe(true);
    const order = createdOrder();
    for (const line of order.lineItems) expect(line.note).toBeUndefined();
    expect(order.fulfillments[0].pickupDetails.note).toBe("DE999");
  });
});
