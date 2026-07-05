import { describe, it, expect, vi, beforeEach } from "vitest";

// App build attribution: x-mbt-app-version / x-mbt-platform headers →
// metadata.app_client on the created Square order. Wiring test — the
// sanitizers + entry-budget invariants live in src/lib/order-metadata.test.ts.

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
  // Reject → priceMaps null → discount/tier branches skipped; the metadata
  // stamp runs regardless.
  getMenu: vi.fn().mockRejectedValue(new Error("menu unavailable in test")),
}));
vi.mock("@/lib/supabase", () => ({
  nextOnlineOrderNumber: vi.fn().mockResolvedValue("OL800"),
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

const PICKUP_BODY = {
  lines: [
    { variationId: "VAR1", variationPriceCents: 600, quantity: 1, modifiers: [] },
  ],
  fulfillmentType: "PICKUP",
};

function orderRequest(headers: Record<string, string>): Request {
  return new Request("http://test/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(PICKUP_BODY),
  });
}

function createdMetadata(): Record<string, string> {
  expect(ordersCreate).toHaveBeenCalledTimes(1);
  return ordersCreate.mock.calls[0][0].order.metadata;
}

describe("POST /api/orders — app build attribution metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthedUser).mockResolvedValue({
      profile: { square_customer_id: "C1", phone_e164: "+61400000000" },
    } as Awaited<ReturnType<typeof getAuthedUser>>);
    vi.mocked(getEffectiveOrderingStatus).mockResolvedValue({
      open: true,
      nextLabel: "until 10:30pm",
    });
    ordersSearch.mockResolvedValue({ orders: [] });
    ordersCreate.mockResolvedValue({
      order: { id: "sq_order_1", totalMoney: { amount: 600n } },
    });
  });

  it("app request with version headers → metadata.app_client = 'ios/1.1.4+22'", async () => {
    const res = await POST(
      orderRequest({
        "x-client-platform": "app",
        "x-mbt-app-version": "1.1.4+22",
        "x-mbt-platform": "ios",
      }),
    );
    expect(res.status).toBe(200);
    const metadata = createdMetadata();
    expect(metadata.source).toBe("app");
    expect(metadata.app_client).toBe("ios/1.1.4+22");
  });

  it("web (browser) request → no app_client entry", async () => {
    const res = await POST(
      orderRequest({
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      }),
    );
    expect(res.status).toBe(200);
    const metadata = createdMetadata();
    expect(metadata.source).toBe("web");
    expect(metadata).not.toHaveProperty("app_client");
  });

  it("app request with an ILLEGAL version header → no app_client entry", async () => {
    const res = await POST(
      orderRequest({
        "x-client-platform": "app",
        "x-mbt-app-version": "<script>alert(1)</script>",
        "x-mbt-platform": "ios",
      }),
    );
    expect(res.status).toBe(200);
    const metadata = createdMetadata();
    expect(metadata.source).toBe("app");
    expect(metadata).not.toHaveProperty("app_client");
  });

  it("app request missing the platform header → app_client uses '?' bucket", async () => {
    const res = await POST(
      orderRequest({
        "x-client-platform": "app",
        "x-mbt-app-version": "1.1.4+22",
      }),
    );
    expect(res.status).toBe(200);
    expect(createdMetadata().app_client).toBe("?/1.1.4+22");
  });
});
