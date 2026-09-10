import { describe, expect, it } from "vitest";
import {
  RECENT_KEEP,
  brisbaneHour,
  favouriteItem,
  foldOrders,
  groupByCustomer,
  medianGapDays,
  type OrderFact,
} from "./customer-state";

const NOW = new Date("2026-09-10T02:00:00.000Z");
const order = (id: string, at: string, items: Array<[string, number]> = [["Taro Milk Tea", 1]]): OrderFact => ({
  id,
  customerId: "c1",
  createdAt: at,
  channel: "app",
  items: items.map(([name, qty]) => ({ name, qty })),
});

describe("foldOrders", () => {
  it("builds first/last/count/items from scratch", () => {
    const s = foldOrders(
      null,
      [
        order("b", "2026-09-05T08:00:00Z", [["Mango Slushy", 2]]),
        order("a", "2026-09-01T03:00:00Z"),
      ],
      NOW,
    );
    expect(s.first_order_at).toBe("2026-09-01T03:00:00.000Z");
    expect(s.last_order_at).toBe("2026-09-05T08:00:00.000Z");
    expect(s.order_count).toBe(2);
    expect(s.item_counts).toEqual({ "Taro Milk Tea": 1, "Mango Slushy": 2 });
    expect(s.recent_orders.map((o) => o.id)).toEqual(["a", "b"]);
    // 08:00Z is 18:00 Brisbane → an evening order; 03:00Z is 13:00.
    expect(s.evening_orders).toBe(1);
  });

  it("is idempotent over an overlapping re-scan", () => {
    const first = foldOrders(null, [order("a", "2026-09-01T03:00:00Z")], NOW);
    const again = foldOrders(first, [order("a", "2026-09-01T03:00:00Z"), order("b", "2026-09-03T03:00:00Z")], NOW);
    expect(again.order_count).toBe(2);
    expect(again.item_counts["Taro Milk Tea"]).toBe(2);
    expect(foldOrders(again, [], NOW)).toBe(again);
  });

  it("keeps only the newest RECENT_KEEP orders but the full count", () => {
    const many = Array.from({ length: RECENT_KEEP + 5 }, (_, i) =>
      order(`o${i}`, new Date(Date.UTC(2026, 0, 1 + i)).toISOString()),
    );
    const s = foldOrders(null, many, NOW);
    expect(s.order_count).toBe(RECENT_KEEP + 5);
    expect(s.recent_orders).toHaveLength(RECENT_KEEP);
    expect(s.recent_orders[0].id).toBe("o5");
  });

  it("caps the item table at the top entries", () => {
    const items: Array<[string, number]> = Array.from({ length: 20 }, (_, i) => [`Drink ${i}`, i + 1]);
    const s = foldOrders(null, [order("a", "2026-09-01T03:00:00Z", items)], NOW);
    expect(Object.keys(s.item_counts)).toHaveLength(12);
    expect(favouriteItem(s)).toBe("Drink 19");
  });
});

describe("medianGapDays", () => {
  it("is the median of consecutive gaps, null under two orders", () => {
    const s = foldOrders(
      null,
      [
        order("a", "2026-08-01T00:00:00Z"),
        order("b", "2026-08-04T00:00:00Z"),
        order("c", "2026-08-14T00:00:00Z"),
        order("d", "2026-08-18T00:00:00Z"),
      ],
      NOW,
    );
    expect(medianGapDays(s)).toBe(4); // gaps 3, 10, 4 → median 4
    expect(medianGapDays(foldOrders(null, [order("a", "2026-08-01T00:00:00Z")], NOW))).toBeNull();
  });
});

describe("helpers", () => {
  it("brisbaneHour is UTC+10", () => {
    expect(brisbaneHour("2026-09-10T02:30:00Z")).toBe(12);
    expect(brisbaneHour("2026-09-10T14:30:00Z")).toBe(0);
    expect(brisbaneHour("2026-09-10T07:00:00Z")).toBe(17);
  });

  it("groupByCustomer drops anonymous orders", () => {
    const g = groupByCustomer([
      order("a", "2026-09-01T03:00:00Z"),
      { ...order("b", "2026-09-01T04:00:00Z"), customerId: "" },
      { ...order("c", "2026-09-01T05:00:00Z"), customerId: "c2" },
    ]);
    expect([...g.keys()].sort()).toEqual(["c1", "c2"]);
    expect(g.get("c1")).toHaveLength(1);
  });
});
