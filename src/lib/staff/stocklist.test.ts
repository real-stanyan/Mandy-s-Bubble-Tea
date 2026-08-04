import { describe, it, expect } from "vitest";
import {
  ALL_ITEMS,
  STOCK_LIST,
  buildReport,
  isOrderDay,
  type Counted,
  type StockItem,
} from "./stocklist";

function item(id: string): StockItem {
  const found = ALL_ITEMS.find((i) => i.id === id);
  if (!found) throw new Error(`no such item: ${id}`);
  return found;
}

// 2026-08-04 is a Tuesday. 10:00 UTC is 20:00 Brisbane the same day.
const TUESDAY = new Date("2026-08-04T10:00:00Z");
const WEDNESDAY = new Date("2026-08-05T10:00:00Z");

describe("the list itself", () => {
  it("has unique ids across every category", () => {
    const ids = ALL_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps same-named items in different categories distinct", () => {
    // Orange and Lemon exist as both a syrup and a fresh fruit; collapsing
    // them would silently drop one of the two from the count sheet.
    expect(item("syrup-orange").name).toBe("Orange");
    expect(item("other-orange").name).toBe("Orange");
    expect(item("syrup-lemon").id).not.toBe(item("other-lemon").id);
  });

  it("has no empty category", () => {
    for (const c of STOCK_LIST) expect(c.items.length).toBeGreaterThan(0);
  });
});

describe("threshold rule", () => {
  it("flags at the threshold, not just below it", () => {
    // "1" means one left already needs reordering — the next delivery is
    // not same-day, so waiting for 0 means running out.
    const r = buildReport([{ item: item("syrup-mango"), qty: 1 }], WEDNESDAY);
    expect(r.reorder.map((x) => x.item.id)).toEqual(["syrup-mango"]);
  });

  it("does not flag above the threshold", () => {
    const r = buildReport([{ item: item("syrup-mango"), qty: 2 }], WEDNESDAY);
    expect(r.reorder).toHaveLength(0);
    expect(r.ok).toHaveLength(1);
  });

  it("handles fractional thresholds", () => {
    const herbal = item("topping-herbal-jelly"); // 0.3
    expect(buildReport([{ item: herbal, qty: 0.3 }], WEDNESDAY).reorder).toHaveLength(1);
    expect(buildReport([{ item: herbal, qty: 0.5 }], WEDNESDAY).reorder).toHaveLength(0);
  });

  it("flags zero", () => {
    const r = buildReport([{ item: item("other-banana"), qty: 0 }], WEDNESDAY);
    expect(r.reorder).toHaveLength(1);
  });
});

describe("weekly rule", () => {
  const honey = item("syrup-honey");

  it("reports remaining quantity on Tuesday", () => {
    const r = buildReport([{ item: honey, qty: 4 }], TUESDAY);
    expect(r.isOrderDay).toBe(true);
    expect(r.weekly).toEqual([{ item: honey, qty: 4 }]);
    expect(r.reorder).toHaveLength(0);
  });

  it("stays quiet on other days", () => {
    const r = buildReport([{ item: honey, qty: 4 }], WEDNESDAY);
    expect(r.weekly).toHaveLength(0);
    expect(r.ok).toHaveLength(1);
  });

  it("never lands in reorder, however low the count", () => {
    // Weekly items have no threshold at all — a low count must not start
    // firing daily reorder prompts, which is the whole reason for the rule.
    for (const now of [TUESDAY, WEDNESDAY]) {
      const r = buildReport([{ item: honey, qty: 0 }], now);
      expect(r.reorder).toHaveLength(0);
    }
  });
});

describe("blank entries", () => {
  it("are reported as missing, not as zero", () => {
    // Zero means "we have none, order it"; blank means "nobody looked".
    // Treating blank as zero would invent an urgent reorder.
    const counts: Counted[] = [{ item: item("syrup-mango"), qty: null }];
    const r = buildReport(counts, WEDNESDAY);
    expect(r.missing.map((i) => i.id)).toEqual(["syrup-mango"]);
    expect(r.reorder).toHaveLength(0);
    expect(r.ok).toHaveLength(0);
  });

  it("treats NaN like a blank", () => {
    const r = buildReport([{ item: item("syrup-mango"), qty: NaN }], WEDNESDAY);
    expect(r.missing).toHaveLength(1);
  });
});

describe("isOrderDay", () => {
  it("is true on Tuesday in shop time", () => {
    expect(isOrderDay(TUESDAY)).toBe(true);
  });

  it("uses Brisbane time, not UTC", () => {
    // 2026-08-03T23:00Z is still Monday in UTC but already Tuesday 09:00 in
    // Brisbane — the shop is opening and the weekly items belong on today's
    // order.
    expect(isOrderDay(new Date("2026-08-03T23:00:00Z"))).toBe(true);
    // And the mirror case: Tuesday 15:00 UTC is Wednesday 01:00 Brisbane.
    expect(isOrderDay(new Date("2026-08-04T15:00:00Z"))).toBe(false);
  });
});
