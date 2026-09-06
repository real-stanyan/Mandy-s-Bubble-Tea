import { describe, it, expect, vi, beforeEach } from "vitest";

// OL890 (2026-09-06): a $0 order whose checkout never finished showed up in
// the App as "Received" — the paid-filter here can't tell it from a settled
// free drink (both: OPEN, due 0, no tender). The route asks the print ledger
// (findGhostZeroOrderIds) and drops the ghosts.

const mockSearch = vi.fn();
const mockGhosts = vi.fn();

vi.mock("@/lib/square", () => ({
  SQUARE_LOCATION_ID: "L1",
  squareClient: { orders: { search: (...a: unknown[]) => mockSearch(...a) } },
}));
vi.mock("@/lib/catalog", () => ({
  getMenu: vi.fn().mockResolvedValue({
    itemsBySlug: new Map(),
    uncategorizedItems: [],
    modifierLists: new Map(),
  }),
}));
vi.mock("@/lib/auth", () => ({
  getAuthedUser: vi.fn().mockResolvedValue({
    userId: "u1",
    profile: { square_customer_id: "C1", phone_e164: "+61400000000" },
  }),
}));
vi.mock("@/lib/driver-tokens", () => ({
  getDeliveredOrderIds: vi.fn().mockResolvedValue(new Set<string>()),
}));
vi.mock("@/lib/orders/ghost-zero-order", () => ({
  findGhostZeroOrderIds: (...a: unknown[]) => mockGhosts(...a),
}));

import { GET } from "./route";

const now = new Date().toISOString();
const line = {
  catalogObjectId: "VAR1",
  name: "Mango Slushy",
  variationName: "Regular",
  quantity: "1",
  basePriceMoney: { amount: 780n },
  modifiers: [],
};
const zeroOpen = (id: string) => ({
  id,
  state: "OPEN",
  createdAt: now,
  referenceId: id,
  totalMoney: { amount: 0n },
  netAmountDueMoney: { amount: 0n },
  tenders: [],
  lineItems: [line],
  fulfillments: [{ type: "PICKUP", state: "PROPOSED" }],
  metadata: { source: "app" },
});
const paid = {
  id: "paid",
  state: "OPEN",
  createdAt: now,
  referenceId: "OL892",
  totalMoney: { amount: 1500n },
  netAmountDueMoney: { amount: 0n },
  tenders: [{ id: "t1", type: "CARD", cardDetails: { status: "CAPTURED" } }],
  lineItems: [line],
  fulfillments: [{ type: "PICKUP", state: "PROPOSED" }],
  metadata: { source: "app" },
};

describe("GET /api/orders/history — ghost $0 orders are hidden", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("drops the ids the ledger flags and keeps everything else", async () => {
    mockSearch.mockResolvedValue({ orders: [zeroOpen("OL890"), zeroOpen("OL891"), paid] });
    mockGhosts.mockResolvedValue(new Set(["OL890"]));

    const res = await GET(new Request("http://test/api/orders/history"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.orders.map((o: { id: string }) => o.id)).toEqual(["OL891", "paid"]);
    // The ledger is asked about the whole paid list, once.
    expect(mockGhosts).toHaveBeenCalledTimes(1);
    expect(mockGhosts.mock.calls[0][0].map((o: { id: string }) => o.id)).toEqual([
      "OL890",
      "OL891",
      "paid",
    ]);
  });

  it("nothing flagged → nothing hidden", async () => {
    mockSearch.mockResolvedValue({ orders: [zeroOpen("OL891"), paid] });
    mockGhosts.mockResolvedValue(new Set());
    const json = await (await GET(new Request("http://test/api/orders/history"))).json();
    expect(json.orders).toHaveLength(2);
    expect(json.orders[0].active).toBe(true);
  });
});
