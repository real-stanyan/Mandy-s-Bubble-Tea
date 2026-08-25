import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock just enough to reach the delivery-toggle gate. Everything heavier
// (Square order creation, pricing, loyalty) lives AFTER the gate, so the
// 409 path never touches it.
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
  // Throw so priceMaps falls back to null (cache-outage path) — the gate runs
  // regardless of pricing, and the fee tests below exercise the client-price
  // fallback for both the subtotal and the reward-cup estimate.
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
import {
  getEffectiveOrderingStatus,
  isDeliveryEnabled,
} from "@/lib/store-status-server";
import { getMenu } from "@/lib/catalog";
import { cartHash } from "@/lib/order-dedup";
import { nextOnlineOrderNumber } from "@/lib/supabase";

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

describe("POST /api/orders — bulk ceiling", () => {
  beforeEach(() => {
    ordersCreate.mockReset();
    vi.mocked(getAuthedUser).mockResolvedValue({
      profile: { square_customer_id: "C1", phone_e164: "+61400000000" },
    } as Awaited<ReturnType<typeof getAuthedUser>>);
    vi.mocked(getEffectiveOrderingStatus).mockResolvedValue({
      open: true,
      nextLabel: "until 10:30pm",
    });
  });

  it("refuses a 51-cup cart with the arranged-by-Rick message, before any Square work", async () => {
    const res = await POST(
      orderRequest({
        lines: [
          { variationId: "VAR1", variationPriceCents: 600, quantity: 30, modifiers: [] },
          { variationId: "VAR1", variationPriceCents: 600, quantity: 21, modifiers: [] },
        ],
        fulfillmentType: "PICKUP",
      }),
    );
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.bulkTooLarge).toBe(true);
    expect(json.error).toContain("over 50 cups");
    expect(ordersCreate).not.toHaveBeenCalled();
  });

  it("lets exactly 50 cups through the ceiling", async () => {
    const res = await POST(
      orderRequest({
        lines: [
          { variationId: "VAR1", variationPriceCents: 600, quantity: 50, modifiers: [] },
        ],
        fulfillmentType: "PICKUP",
      }),
    );
    const json = await res.json().catch(() => ({}));
    // May fail later for unrelated reasons (test env has no Square) — only
    // the ceiling's own refusal must not fire.
    expect(json.bulkTooLarge).toBeUndefined();
  });
});

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

describe("POST /api/orders — delivery fees on the POST-discount paid amount", () => {
  // Store → (-27.96, 153.41) ≈ 0.68km ⇒ 0–2km band: $3.99, free at/above $35.
  const deliveryBody = (over: Record<string, unknown>) => ({
    fulfillmentType: "DELIVERY",
    delivery: {
      address: "34 Davenport St, Southport",
      lat: -27.96,
      lng: 153.41,
      postcode: "4215",
    },
    ...over,
  });
  const cup = (cents: number, quantity = 1) => ({
    itemName: "Test Cup",
    variationId: "VAR1",
    variationPriceCents: cents,
    quantity,
    modifiers: [],
  });
  const chargesOf = () => {
    const order = ordersCreate.mock.calls[0][0].order;
    return Object.fromEntries(
      (order.serviceCharges ?? []).map(
        (c: { uid: string; amountMoney?: { amount: bigint } }) => [
          c.uid,
          c.amountMoney?.amount,
        ],
      ),
    );
  };

  beforeEach(() => {
    ordersCreate.mockReset();
    ordersSearch.mockReset();
    ordersSearch.mockResolvedValue({ orders: [] });
    ordersCreate.mockResolvedValue({
      order: { id: "ORD1", totalMoney: { amount: 443n } },
    });
    vi.mocked(getAuthedUser).mockReset();
    vi.mocked(getAuthedUser).mockResolvedValue({
      profile: { square_customer_id: "C1", phone_e164: "+61400000000" },
    } as Awaited<ReturnType<typeof getAuthedUser>>);
    vi.mocked(getEffectiveOrderingStatus).mockResolvedValue({
      open: true,
      nextLabel: "until 10:30pm",
    });
    vi.mocked(isDeliveryEnabled).mockResolvedValue(true);
  });

  it("no discounts: fee + svc on the full subtotal, platform/card attached", async () => {
    const res = await POST(
      orderRequest(deliveryBody({ lines: [cup(880, 2)] })),
    );
    expect((await res.json()).ok).toBe(true);
    const charges = chargesOf();
    expect(charges["delivery-fee"]).toBe(399n); // $17.60 < $35
    expect(charges["service-fee"]).toBe(88n); // 5% × $17.60
    expect(charges["platform-fee"]).toBeUndefined(); // percentage-based, no amountMoney
    expect("platform-fee" in charges).toBe(true);
    expect("card-surcharge" in charges).toBe(true);
  });

  it("star redeem no longer skips delivery fees: fee on paid = subtotal − reward cup", async () => {
    const res = await POST(
      orderRequest(
        deliveryBody({
          lines: [cup(880, 2)],
          applyLoyaltyReward: true,
          loyaltyRewardCount: 1,
        }),
      ),
    );
    expect((await res.json()).ok).toBe(true);
    const charges = chargesOf();
    expect(charges["delivery-fee"]).toBe(399n); // paid $8.80 < $35
    expect(charges["service-fee"]).toBe(44n); // 5% × $8.80 paid, not $17.60 pre
    // PH/platform/card stay skipped on redeem orders (unchanged behavior).
    expect("platform-fee" in charges).toBe(false);
    expect("card-surcharge" in charges).toBe(false);
  });

  it("full star redeem (paid $0): band fee still charged, svc omitted", async () => {
    const res = await POST(
      orderRequest(
        deliveryBody({
          lines: [cup(1280, 1)], // pre $12.80 ≥ $12 minimum (min uses pre)
          applyLoyaltyReward: true,
          loyaltyRewardCount: 1,
        }),
      ),
    );
    expect((await res.json()).ok).toBe(true);
    const charges = chargesOf();
    expect(charges["delivery-fee"]).toBe(399n);
    expect("service-fee" in charges).toBe(false); // 5% × $0
  });

  it("free threshold folds in the 5% service fee: $36 pre − $2 reward → paid $34, +svc clears $35 → FREE", async () => {
    // paid = $34.00; +5% service ($1.70) = $35.70 ≥ $35 → delivery waived.
    // (Redeem orders skip platform/card, so only the service fee folds in.)
    const res = await POST(
      orderRequest(
        deliveryBody({
          lines: [cup(200, 1), cup(3400, 1)],
          applyLoyaltyReward: true,
          loyaltyRewardCount: 1,
        }),
      ),
    );
    expect((await res.json()).ok).toBe(true);
    const charges = chargesOf();
    expect("delivery-fee" in charges).toBe(false);
    expect(charges["service-fee"]).toBe(170n); // 5% × $34 paid
  });

  it("still judged on the paid amount: $37 pre − $4 reward → paid $33, even +svc under $35 → fee charged", async () => {
    // paid = $33.00; +5% service ($1.65) = $34.65 < $35 → band fee applies,
    // proving the threshold is not reached on the $37 sticker price.
    const res = await POST(
      orderRequest(
        deliveryBody({
          lines: [cup(400, 1), cup(3300, 1)],
          applyLoyaltyReward: true,
          loyaltyRewardCount: 1,
        }),
      ),
    );
    expect((await res.json()).ok).toBe(true);
    const charges = chargesOf();
    expect(charges["delivery-fee"]).toBe(399n); // paid $33 + $1.65 svc < $35
  });

  it("undiscounted order at/above $35 keeps FREE delivery", async () => {
    const res = await POST(
      orderRequest(deliveryBody({ lines: [cup(3500, 1)] })),
    );
    expect((await res.json()).ok).toBe(true);
    const charges = chargesOf();
    expect("delivery-fee" in charges).toBe(false);
    expect(charges["service-fee"]).toBe(175n); // 5% × $35
  });
});

describe("POST /api/orders — a cart line the catalog dropped", () => {
  // Same failure the quote declines to price (#84): an item deleted and
  // re-added in Square gets a new id, and the old one sits in a persisted cart
  // forever. Absent from the catalog is NOT the same as sold out — the sold-out
  // scan finds no entry and waves it through, so without this guard the request
  // reaches Square and comes back as a payment failure the customer can't act on.
  const menuWith = (variationIds: string[]) => ({
    itemsBySlug: new Map([
      [
        "milky",
        [
          {
            name: "Taro Milk Tea",
            variations: variationIds.map((id) => ({
              id,
              name: "",
              priceCents: 600n,
              soldOut: false,
            })),
          },
        ],
      ],
    ]),
    uncategorizedItems: [],
    modifierLists: new Map(),
  });

  const pickupBody = (variationId: string) => ({
    fulfillmentType: "PICKUP",
    lines: [
      {
        itemName: "Taro Milk Tea",
        variationId,
        variationPriceCents: 600,
        quantity: 1,
        modifiers: [],
      },
    ],
  });

  beforeEach(() => {
    ordersCreate.mockReset();
    ordersSearch.mockReset();
    ordersSearch.mockResolvedValue({ orders: [] });
    ordersCreate.mockResolvedValue({
      order: { id: "ORD1", totalMoney: { amount: 600n } },
    });
    vi.mocked(getAuthedUser).mockResolvedValue({
      profile: { square_customer_id: "C1", phone_e164: "+61400000000" },
    } as Awaited<ReturnType<typeof getAuthedUser>>);
    vi.mocked(getEffectiveOrderingStatus).mockResolvedValue({
      open: true,
      nextLabel: "until 10:30pm",
    });
    vi.mocked(isDeliveryEnabled).mockResolvedValue(true);
  });

  it("rejects with 409 and names the id, without calling Square", async () => {
    vi.mocked(getMenu).mockResolvedValue(
      menuWith(["VAR_LIVE"]) as unknown as Awaited<ReturnType<typeof getMenu>>,
    );
    const res = await POST(orderRequest(pickupBody("VAR_DELETED")));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.unknownVariationIds).toEqual(["VAR_DELETED"]);
    expect(ordersCreate).not.toHaveBeenCalled();
  });

  it("lets a cart the catalog still recognises through", async () => {
    vi.mocked(getMenu).mockResolvedValue(
      menuWith(["VAR_LIVE"]) as unknown as Awaited<ReturnType<typeof getMenu>>,
    );
    const res = await POST(orderRequest(pickupBody("VAR_LIVE")));
    expect((await res.json()).ok).toBe(true);
  });

  it("does not block the order when the menu fetch itself failed", async () => {
    // priceMaps is null in that case — we can't tell a retired id from a live
    // one, and refusing every order during a cache outage would be worse.
    vi.mocked(getMenu).mockRejectedValue(new Error("catalog down"));
    const res = await POST(orderRequest(pickupBody("VAR_ANYTHING")));
    expect((await res.json()).ok).toBe(true);
  });
});

describe("POST /api/orders — dedupe draws no pickup number", () => {
  const lines = [
    {
      itemName: "Test Cup",
      variationId: "VAR1",
      variationPriceCents: 600,
      quantity: 1,
      modifiers: [],
    },
  ];

  beforeEach(() => {
    ordersCreate.mockReset();
    ordersSearch.mockReset();
    vi.mocked(nextOnlineOrderNumber).mockClear();
    vi.mocked(getAuthedUser).mockResolvedValue({
      profile: { square_customer_id: "C1", phone_e164: "+61400000000" },
    } as Awaited<ReturnType<typeof getAuthedUser>>);
    vi.mocked(getEffectiveOrderingStatus).mockResolvedValue({
      open: true,
      nextLabel: "until 10:30pm",
    });
  });

  it("reuses the recent identical order and never touches the counter", async () => {
    // The 2026-08-25 morning: a customer flip-flopping between card and
    // Apple Pay re-posted the same cart five times; dedupe correctly reused
    // the order, but the number was drawn BEFORE the dedupe check, so the
    // day went OL800 → OL805 with 801–804 never existing. The draw now
    // lives after the dedupe, and this pins it there.
    ordersSearch.mockResolvedValue({
      orders: [
        {
          id: "DUP1",
          state: "OPEN",
          createdAt: new Date().toISOString(),
          metadata: { cart_hash: cartHash(lines) },
          totalMoney: { amount: 600n },
        },
      ],
    });

    const res = await POST(orderRequest({ lines, fulfillmentType: "PICKUP" }));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.deduped).toBe(true);
    expect(body.orderId).toBe("DUP1");
    expect(nextOnlineOrderNumber).not.toHaveBeenCalled();
    expect(ordersCreate).not.toHaveBeenCalled();
  });

  it("still draws a number when no duplicate exists", async () => {
    ordersSearch.mockResolvedValue({ orders: [] });
    ordersCreate.mockResolvedValue({
      order: { id: "ORD_NEW", totalMoney: { amount: 600n } },
    });

    const res = await POST(orderRequest({ lines, fulfillmentType: "PICKUP" }));
    expect((await res.json()).ok).toBe(true);
    expect(nextOnlineOrderNumber).toHaveBeenCalledTimes(1);
    expect(ordersCreate).toHaveBeenCalledTimes(1);
  });
});
