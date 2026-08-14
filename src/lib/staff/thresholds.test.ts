import { describe, it, expect } from "vitest";
import {
  ALL_ITEMS,
  applyThresholds,
  buildReport,
  defaultThreshold,
  findItem,
  type Counted,
  type ThresholdOverrides,
} from "./stocklist";

const WED = new Date("2026-08-12T02:00:00Z");

function itemsOf(list: ReturnType<typeof applyThresholds>) {
  return list.flatMap((c) => c.items);
}

describe("editable reorder thresholds", () => {
  it("changes the number an item is judged against", () => {
    const overrides: ThresholdOverrides = {
      "other-fresh-milk": { value: 9, by: "Stan", at: "2026-08-14T00:00:00Z" },
    };
    const milk = itemsOf(applyThresholds(overrides)).find(
      (i) => i.id === "other-fresh-milk",
    )!;
    expect(milk.rule).toEqual({ kind: "threshold", value: 9 });
  });

  it("actually flags a count that the default would have passed", () => {
    // The whole point. Fresh Milk defaults to 5; at 7 it is fine. Raise the
    // threshold to 9 and the same 7 has to become an order — if this passes
    // with the default the editor is decoration.
    const milk = findItem("other-fresh-milk")!;
    expect(defaultThreshold("other-fresh-milk")).toBe(5);

    const before = buildReport([{ item: milk, qty: 7 }] as Counted[], WED);
    expect(before.reorder).toEqual([]);

    const raised = itemsOf(
      applyThresholds({ "other-fresh-milk": { value: 9, by: null, at: null } }),
    ).find((i) => i.id === "other-fresh-milk")!;
    const after = buildReport([{ item: raised, qty: 7 }] as Counted[], WED);
    expect(after.reorder.map((r) => r.item.id)).toEqual(["other-fresh-milk"]);
    expect(after.reorder[0]!.threshold).toBe(9);
  });

  it("leaves the defaults in code untouched", () => {
    // applyThresholds returns a new list. If it mutated STOCK_LIST the
    // original number would be gone and "reset to default" would restore
    // whatever the last override happened to be.
    applyThresholds({ "other-fresh-milk": { value: 99, by: null, at: null } });
    expect(defaultThreshold("other-fresh-milk")).toBe(5);
  });

  it("ignores an override on an item with no threshold", () => {
    // Weekly and sufficiency items never compare a count against a number,
    // so a value here would be stored and never read — worse, it would show
    // in the editor as a setting that does something.
    const cups = itemsOf(
      applyThresholds({ "packaging-cups": { value: 3, by: null, at: null } }),
    ).find((i) => i.id === "packaging-cups")!;
    expect(cups.rule.kind).toBe("sufficiency");

    const blackTea = itemsOf(
      applyThresholds({ "tea-black": { value: 3, by: null, at: null } }),
    ).find((i) => i.id === "tea-black")!;
    expect(blackTea.rule.kind).toBe("weekly");
  });

  it("ignores an id that is not on the list", () => {
    const before = itemsOf(applyThresholds({}));
    const after = itemsOf(applyThresholds({ nope: { value: 1, by: null, at: null } }));
    expect(after.length).toBe(before.length);
  });

  it("has a default for every threshold item, and none for the others", () => {
    for (const item of ALL_ITEMS) {
      const d = defaultThreshold(item.id);
      if (item.rule.kind === "threshold") expect(d).toBe(item.rule.value);
      else expect(d).toBeNull();
    }
  });
});
