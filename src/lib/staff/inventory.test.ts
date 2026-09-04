import { describe, expect, it } from "vitest";
import {
  addItem,
  applyPickup,
  buildView,
  estimateUsage,
  patchItems,
  recordShopCount,
  seedState,
  shopCountFromRaw,
  shopOnHand,
  suggestPickup,
  type PickupRecord,
  type ShopCount,
} from "./inventory";

const NOW = new Date("2026-09-05T02:00:00.000Z");

describe("seedState", () => {
  it("lists every daily stock line, none of the weekly ones, with Stan's quantities", () => {
    const s = seedState(NOW);
    const ids = s.items.map((i) => i.id);
    expect(ids).toContain("syrup-mango");
    expect(ids).toContain("packaging-cups");
    expect(ids).not.toContain("syrup-honey"); // weekly
    expect(ids).not.toContain("tea-black"); // weekly
    expect(s.items.find((i) => i.id === "syrup-pf")?.qty).toBe(138);
    expect(s.items.find((i) => i.id === "topping-lychee-jelly")?.qty).toBe(20);
    expect(s.items.find((i) => i.id === "syrup-pa")?.qty).toBeNull();
    expect(s.items.find((i) => i.id === "packaging-cups")?.hasShopCount).toBe(false);
  });
});

describe("shopCountFromRaw", () => {
  it("keeps numbers and drops blanks and sufficiency answers", () => {
    const c = shopCountFromRaw("2026-09-04", {
      "syrup-mango": "2",
      "topping-herbal-jelly": "0.7",
      "syrup-pa": "",
      "packaging-cups": "maybe",
    });
    expect(c.counts).toEqual({ "syrup-mango": 2, "topping-herbal-jelly": 0.7 });
  });
});

describe("estimateUsage", () => {
  const counts: ShopCount[] = [
    { date: "2026-09-01", counts: { "syrup-mango": 6 } },
    { date: "2026-09-02", counts: { "syrup-mango": 4 } },
    { date: "2026-09-04", counts: { "syrup-mango": 5 } },
  ];
  const pickups: PickupRecord[] = [
    { date: "2026-09-03", at: "", by: null, lines: [{ id: "syrup-mango", qty: 5 }] },
  ];

  it("measures usage across consecutive counts and credits deliveries", () => {
    // 01→02: used 2 in 1 day. 02→04: 4 + 5 delivered − 5 = 4 in 2 days.
    const u = estimateUsage("syrup-mango", counts, pickups, "2026-09-05");
    expect(u.intervals).toBe(2);
    expect(u.spanDays).toBe(3);
    expect(u.perDay).toBeCloseTo(6 / 3);
  });

  it("is null with a single reading", () => {
    expect(estimateUsage("syrup-mango", [counts[0]], [], "2026-09-05").perDay).toBeNull();
  });

  it("skips an interval where the count went up without a delivery", () => {
    const odd: ShopCount[] = [
      { date: "2026-09-01", counts: { x: 2 } },
      { date: "2026-09-02", counts: { x: 9 } },
      { date: "2026-09-03", counts: { x: 6 } },
    ];
    const u = estimateUsage("x", odd, [], "2026-09-05");
    expect(u.intervals).toBe(1);
    expect(u.perDay).toBe(3);
  });

  it("ignores readings older than the window", () => {
    const old: ShopCount[] = [
      { date: "2026-07-01", counts: { x: 10 } },
      { date: "2026-07-02", counts: { x: 0 } },
    ];
    expect(estimateUsage("x", old, [], "2026-09-05").perDay).toBeNull();
  });
});

describe("shopOnHand", () => {
  it("adds pickups made on or after the latest count day", () => {
    const counts: ShopCount[] = [{ date: "2026-09-04", counts: { x: 2 } }];
    const pickups: PickupRecord[] = [
      { date: "2026-09-03", at: "", by: null, lines: [{ id: "x", qty: 9 }] },
      { date: "2026-09-04", at: "", by: null, lines: [{ id: "x", qty: 3 }] },
    ];
    expect(shopOnHand("x", counts, pickups)).toEqual({ qty: 5, countedOn: "2026-09-04" });
  });
});

describe("suggestPickup", () => {
  it("tops the shop up to the cover in whole units", () => {
    expect(suggestPickup(2, 2, 100, 3)).toEqual({ bring: 4, reason: "topup" });
    expect(suggestPickup(1.5, 1, 100, 3)).toEqual({ bring: 4, reason: "topup" });
  });
  it("brings nothing when the shop is covered", () => {
    expect(suggestPickup(2, 6, 100, 3)).toEqual({ bring: 0, reason: "covered" });
  });
  it("suggests the full cover when the shop was never counted", () => {
    expect(suggestPickup(2, null, 100, 3)).toEqual({ bring: 6, reason: "no-shop-count" });
  });
  it("cannot bring more than the warehouse holds", () => {
    expect(suggestPickup(2, 0, 4, 3)).toEqual({ bring: 4, reason: "warehouse-short" });
    expect(suggestPickup(2, 0, 0, 3)).toEqual({ bring: 0, reason: "warehouse-empty" });
  });
  it("suggests nothing without a usage figure", () => {
    expect(suggestPickup(null, 0, 100, 3)).toEqual({ bring: 0, reason: "no-usage" });
  });
});

describe("state transitions", () => {
  it("applyPickup logs the pickup and reduces the warehouse", () => {
    const s = applyPickup(seedState(NOW), [{ id: "syrup-mango", qty: 4 }, { id: "nope", qty: 1 }], "2026-09-05", "Stan", NOW);
    expect(s.items.find((i) => i.id === "syrup-mango")?.qty).toBe(110);
    expect(s.pickups).toHaveLength(1);
    expect(s.pickups[0].lines).toEqual([{ id: "syrup-mango", qty: 4 }]);
  });

  it("applyPickup leaves a blank warehouse quantity blank", () => {
    const s = applyPickup(seedState(NOW), [{ id: "syrup-pa", qty: 2 }], "2026-09-05", null, NOW);
    expect(s.items.find((i) => i.id === "syrup-pa")?.qty).toBeNull();
  });

  it("recordShopCount replaces the same day and keeps order", () => {
    let s = seedState(NOW);
    s = recordShopCount(s, { date: "2026-09-04", counts: { x: 1 } });
    s = recordShopCount(s, { date: "2026-09-03", counts: { x: 5 } });
    s = recordShopCount(s, { date: "2026-09-04", counts: { x: 2 } });
    expect(s.shopCounts.map((c) => c.date)).toEqual(["2026-09-03", "2026-09-04"]);
    expect(s.shopCounts[1].counts.x).toBe(2);
  });

  it("patchItems edits fields and ignores unknown ids", () => {
    const s = patchItems(
      seedState(NOW),
      [
        { id: "syrup-mango", qty: 90, threshold: 20, unit: "bottle", usageOverride: 2.5 },
        { id: "ghost", qty: 1 },
      ],
      NOW,
    );
    const m = s.items.find((i) => i.id === "syrup-mango")!;
    expect(m).toMatchObject({ qty: 90, threshold: 20, unit: "bottle", usageOverride: 2.5 });
    expect(s.items.some((i) => i.id === "ghost")).toBe(false);
  });

  it("addItem creates a custom id and avoids collisions", () => {
    const a = addItem(seedState(NOW), { name: "Brown Sugar Pearls", category: "Topping", qty: 12 }, NOW);
    const b = addItem(a.state, { name: "Brown Sugar Pearls", category: "Topping" }, NOW);
    expect(a.item?.id).toBe("custom-brown-sugar-pearls");
    expect(b.item?.id).toBe("custom-brown-sugar-pearls-2");
    expect(b.item?.hasShopCount).toBe(false);
  });
});

describe("buildView", () => {
  it("prefers an override over the measured usage and flags low stock", () => {
    let s = seedState(NOW);
    s = recordShopCount(s, { date: "2026-09-03", counts: { "syrup-mango": 4 } });
    s = recordShopCount(s, { date: "2026-09-04", counts: { "syrup-mango": 2 } });
    s = patchItems(s, [{ id: "syrup-lychee", threshold: 50 }, { id: "syrup-mango", usageOverride: 3 }], NOW);
    const v = buildView(s, "2026-09-05");
    const mango = v.rows.find((r) => r.id === "syrup-mango")!;
    expect(mango.usage.perDay).toBe(2);
    expect(mango.usagePerDay).toBe(3);
    expect(mango.usageSource).toBe("override");
    expect(mango.suggestion).toEqual({ bring: 7, reason: "topup" }); // 3×3 − 2
    expect(v.rows.find((r) => r.id === "syrup-lychee")?.low).toBe(true); // 48 ≤ 50
  });
});
