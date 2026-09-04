import { describe, expect, it } from "vitest";
import { parseReportDate, parseReports } from "./report-import";

const TEXT = `Mandy's Bubble Tea — stock check Wed, 03 Sep 2026
Counted by: Amy

CUPS & STRAWS:
  - Cups: Enough for today
  - Straws: Maybe

ORDER THESE (3):
  - Straws: Maybe
  - Mango: 1 left (reorder at 2)
  - Orange: 1 left (reorder at 1)

NOT COUNTED (1):
  - PA

(7 weekly items not due today — counted Tuesdays.)

Counted, fine:
  - Peach: 4
  - Herbal Jelly: 0.7
  - Orange: 3
  - Lemon: 2
  - Lemon: 5

Mandy's Bubble Tea — stock check Thu, 04 Sep 2026

Nothing below threshold.

Counted, fine:
  - Mango: 2
  - Peach: 3
`;

describe("parseReportDate", () => {
  it("reads the shop date format", () => {
    expect(parseReportDate("Thu, 04 Sep 2026")).toBe("2026-09-04");
    expect(parseReportDate("4 Sept 2026")).toBe("2026-09-04");
    expect(parseReportDate("nope")).toBeNull();
  });
});

describe("parseReports", () => {
  it("splits pasted emails into one count per day", () => {
    const r = parseReports(TEXT);
    expect(r.counts.map((c) => c.date)).toEqual(["2026-09-03", "2026-09-04"]);
    const d3 = r.counts[0].counts;
    expect(d3["syrup-mango"]).toBe(1);
    expect(d3["syrup-peach"]).toBe(4);
    expect(d3["topping-herbal-jelly"]).toBe(0.7);
    expect(r.counts[1].counts).toEqual({ "syrup-mango": 2, "syrup-peach": 3 });
  });

  it("resolves twin names positionally within a section, and skips a lone twin", () => {
    const r = parseReports(TEXT);
    const d3 = r.counts[0].counts;
    // Both Lemons in "Counted, fine": syrup first, fruit second.
    expect(d3["syrup-lemon"]).toBe(2);
    expect(d3["other-lemon"]).toBe(5);
    // Orange split across sections: neither is recorded.
    expect(d3["syrup-orange"]).toBeUndefined();
    expect(d3["other-orange"]).toBeUndefined();
    expect(r.ambiguous).toEqual(["Orange"]);
  });

  it("ignores sufficiency answers and not-counted names, reports unknown names", () => {
    const r = parseReports(TEXT + "\nCounted, fine:\n  - Dragonfruit Syrup: 3\n");
    expect(Object.keys(r.counts[1].counts)).not.toContain("packaging-cups");
    expect(r.unknown).toEqual(["Dragonfruit Syrup"]);
  });

  it("copes with the HTML version copied out of a mail client", () => {
    const html = `Mandy's Bubble Tea · stock check · Fri, 05 Sep 2026
2 items to order.
Order these
Mango\t1 left · reorder at 2
Counted, fine
Peach\t4
Grape 6`;
    const r = parseReports(html);
    expect(r.counts).toEqual([
      { date: "2026-09-05", counts: { "syrup-mango": 1, "syrup-peach": 4, "syrup-grape": 6 } },
    ]);
  });
});
