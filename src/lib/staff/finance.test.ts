import { describe, expect, it } from "vitest";
import {
  addDaysYmd,
  aggregate,
  buildDaily,
  eachDay,
  emptyFinance,
  parseDoorDashPayments,
  parseFinance,
  removeEntry,
  setRecurring,
  upsertEntry,
  weekStart,
} from "./finance";

const NOW = new Date("2026-09-05T02:00:00.000Z");

describe("parseDoorDashPayments", () => {
  it("reads period and amount out of a payout email, US dates and all", () => {
    const text = `Your DoorDash payment for Mandys Bubble Tea (Southport) (08/31/2026 – 09/01/2026)
DoorDash for Merchants <no-reply@doordash.com> Fri, Sep 4, 2026 at 9:32 PM
Your store will receive a payment of $66.36.*`;
    expect(parseDoorDashPayments(text)).toEqual([
      { from: "2026-08-31", to: "2026-09-01", amount: 66.36, ref: "doordash:2026-08-31..2026-09-01:66.36" },
    ]);
  });
  it("handles several emails pasted together and thousands separators", () => {
    const text = `payment for X (07/01/2026 - 07/02/2026) ... payment of $1,204.10 ...
payment for X (07/03/2026 – 07/03/2026) ... payment of $80.00 ...`;
    const r = parseDoorDashPayments(text);
    expect(r.map((x) => x.amount)).toEqual([1204.1, 80]);
    expect(r[1]).toMatchObject({ from: "2026-07-03", to: "2026-07-03" });
  });
});

describe("ledger", () => {
  it("upsert by ref updates instead of duplicating; parse round-trips", () => {
    let s = emptyFinance();
    s = upsertEntry(s, { kind: "doordash", from: "2026-09-01", to: "2026-09-02", amount: 50, note: "", ref: "r1" }, NOW);
    s = upsertEntry(s, { kind: "doordash", from: "2026-09-01", to: "2026-09-02", amount: 55, note: "", ref: "r1" }, NOW);
    s = upsertEntry(s, { kind: "wages", from: "2026-08-31", to: "2026-09-06", amount: 3000, note: "", ref: "" }, NOW);
    expect(s.entries).toHaveLength(2);
    expect(s.entries.find((e) => e.ref === "r1")?.amount).toBe(55);
    expect(s.entries[0].kind).toBe("wages"); // sorted by from
    const back = parseFinance(JSON.parse(JSON.stringify(s)))!;
    expect(back.entries).toHaveLength(2);
    expect(removeEntry(back, back.entries[0].id).entries).toHaveLength(1);
  });

  it("recurring costs: defaults, legacy rentMonthly, and a wholesale edit", () => {
    expect(emptyFinance().recurring.map((r) => r.id)).toEqual(["rent", "warehouse", "waste", "square-plan", "square-addon"]);
    const legacy = parseFinance({ entries: [], rentMonthly: 2600 })!;
    expect(legacy.recurring.find((r) => r.id === "rent")?.amount).toBe(2600);
    expect(legacy.recurring.find((r) => r.id === "warehouse")?.amount).toBe(950);
    const edited = setRecurring(emptyFinance(), [{ id: "rent", name: "Rent", amount: 2500, per: "month" }, { name: "bad", amount: -1, per: "week" }]);
    expect(edited.recurring).toHaveLength(1);
  });
});

describe("dates", () => {
  it("weekStart is the Monday, in Brisbane", () => {
    expect(weekStart("2026-09-05")).toBe("2026-08-31"); // Saturday → Monday
    expect(weekStart("2026-08-31")).toBe("2026-08-31");
    expect(weekStart("2026-09-06")).toBe("2026-08-31"); // Sunday
    expect(addDaysYmd("2026-08-31", 1)).toBe("2026-09-01");
    expect(eachDay("2026-08-30", "2026-09-01")).toEqual(["2026-08-30", "2026-08-31", "2026-09-01"]);
  });
});

describe("buildDaily + aggregate", () => {
  it("spreads entries over their period, charges rent by month share, and rolls up", () => {
    let f = emptyFinance();
    f = upsertEntry(f, { kind: "doordash", from: "2026-08-31", to: "2026-09-01", amount: 100, note: "", ref: "d" }, NOW);
    f = upsertEntry(f, { kind: "wages", from: "2026-08-31", to: "2026-09-06", amount: 700, note: "", ref: "" }, NOW);
    f = upsertEntry(f, { kind: "electricity", from: "2026-08-01", to: "2026-08-31", amount: 310, note: "", ref: "e" }, NOW);
    const pts = buildDaily({
      from: "2026-08-30",
      to: "2026-09-02",
      squareByDay: { "2026-08-30": 2000, "2026-08-31": 2100, "2026-09-01": 2200, "2026-09-02": 2300 },
      consumptionByDay: { "2026-08-31": { ingredients: 400, packaging: 30 } },
      finance: f,
    });
    expect(pts.map((p) => p.doordash)).toEqual([0, 50, 50, 0]);
    expect(pts.map((p) => p.wages)).toEqual([0, 100, 100, 100]);
    expect(pts[0].electricity).toBe(10); // 310 / 31 days of August
    expect(pts[2].electricity).toBe(0); // September: no bill yet
    // All monthly: (rent 2500 + warehouse 950 + waste 319 + Square 188) / days in the month.
    expect(pts[0].fixed).toBeCloseTo(3957 / 31, 1);
    expect(pts[2].fixed).toBeCloseTo(3957 / 30, 1);

    const weeks = aggregate(pts, "week");
    expect(weeks.map((w) => w.key)).toEqual(["2026-08-24", "2026-08-31"]);
    const w2 = weeks[1];
    expect(w2.days).toBe(3);
    expect(w2.income).toBeCloseTo(2100 + 2200 + 2300 + 100, 2);
    expect(w2.ingredients).toBe(400);
    expect(w2.margin).toBeCloseTo(w2.income - w2.cost, 2);

    const months = aggregate(pts, "month");
    expect(months.map((m) => m.label)).toEqual(["Aug 2026", "Sept 2026"]);
    expect(aggregate(pts, "day")).toHaveLength(4);
  });
});
