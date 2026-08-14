import { describe, it, expect } from "vitest";
import {
  buildReport,
  findItem,
  isSufficiency,
  sufficiencyNeedingAction,
  type Counted,
  type StockItem,
} from "./stocklist";
import { subjectFor, renderReportText } from "./report-email";

const CUPS = findItem("packaging-cups")!;
const STRAWS = findItem("packaging-straws")!;
// A Wednesday, so weekly items stay out of the way of these assertions.
const WED = new Date("2026-08-12T02:00:00Z");

function counted(entries: Array<[StockItem, Counted["level"]]>): Counted[] {
  return entries.map(([item, level]) => ({ item, qty: null, level }));
}

describe("cups and straws", () => {
  it("are on the list and answered, not counted", () => {
    expect(CUPS.rule.kind).toBe("sufficiency");
    expect(STRAWS.rule.kind).toBe("sufficiency");
  });

  it("sorts the worst answer to the top", () => {
    const r = buildReport(
      counted([
        [CUPS, "enough"],
        [STRAWS, "short"],
      ]),
      WED,
    );
    expect(r.sufficiency.map((s) => s.item.id)).toEqual([
      "packaging-straws",
      "packaging-cups",
    ]);
  });

  it("counts 'maybe' as needing action", () => {
    // The reason this is a test and not a comment: treating unsure as fine
    // makes Maybe a synonym for Enough, and then the button is decoration.
    const r = buildReport(counted([[CUPS, "maybe"]]), WED);
    expect(sufficiencyNeedingAction(r).map((s) => s.item.id)).toEqual([
      "packaging-cups",
    ]);
  });

  it("leaves 'enough' out of the order list", () => {
    const r = buildReport(counted([[CUPS, "enough"]]), WED);
    expect(sufficiencyNeedingAction(r)).toEqual([]);
  });

  it("treats an unanswered one as not counted, never as enough", () => {
    // Silence about the cups is the thing worth shouting about; folding it
    // into "fine" would hide the one shelf that stops the counter.
    const r = buildReport(counted([[CUPS, null]]), WED);
    expect(r.missing.map((i) => i.id)).toContain("packaging-cups");
    expect(r.sufficiency).toEqual([]);
  });

  it("rejects a value that is not one of the three answers", () => {
    expect(isSufficiency("enough")).toBe(true);
    expect(isSufficiency("maybe")).toBe(true);
    expect(isSufficiency("short")).toBe(true);
    expect(isSufficiency("7")).toBe(false);
    expect(isSufficiency("")).toBe(false);
  });
});

describe("the report they produce", () => {
  it("puts short cups into the subject's order count", () => {
    // "nothing to order" on a day the cups run out would be the most
    // expensive sentence this file can produce.
    const r = buildReport(counted([[CUPS, "short"]]), WED);
    expect(subjectFor(r, WED)).toContain("1 to order");
    expect(subjectFor(r, WED)).not.toContain("nothing to order");
  });

  it("still says nothing to order when everything is enough", () => {
    const r = buildReport(
      counted([
        [CUPS, "enough"],
        [STRAWS, "enough"],
      ]),
      WED,
    );
    expect(subjectFor(r, WED)).toContain("nothing to order");
  });

  it("names them in words in the text email, not as a number", () => {
    const r = buildReport(counted([[CUPS, "short"]]), WED);
    const text = renderReportText(r, WED, null);
    expect(text).toContain("Cups: Not enough");
    // No invented quantity anywhere near them.
    expect(text).not.toMatch(/Cups: \d/);
  });
});
