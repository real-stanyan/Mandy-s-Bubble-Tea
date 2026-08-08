import { describe, expect, it } from "vitest";
import { resolveCupVisual, describeCup } from "./cup-visual";

/**
 * The rule this pins: the cup reflects what the customer actually picked, and
 * anything it doesn't recognise is skipped rather than guessed at.
 *
 * The mapping is by modifier NAME because ids are Square's and churn whenever
 * the catalog is rebuilt. That makes the name table the fragile part — a
 * renamed topping silently stops drawing — so the cases that matter are
 * pinned here rather than left to a screenshot.
 */

const pick = (...names: string[]) => names.map((name) => ({ name, count: 1 }));

describe("resolveCupVisual — liquid", () => {
  it("reads the flavour, not the base tea", () => {
    // "Mango Iced Green Tea" is a mango drink. Matching "green tea" first
    // would paint every flavoured variant the same pale green.
    const mango = resolveCupVisual({ drinkName: "Mango Iced Green Tea", picked: [] });
    const plain = resolveCupVisual({ drinkName: "Iced Green Tea", picked: [] });
    expect(mango.liquid).not.toBe(plain.liquid);
  });

  it("gives the top seller its own colour", () => {
    const brownSugar = resolveCupVisual({ drinkName: "Brown Sugar Milk Tea", picked: [] });
    const original = resolveCupVisual({ drinkName: "Original Milk Tea", picked: [] });
    expect(brownSugar.liquid).not.toBe(original.liquid);
  });

  it("falls back to milk tea for a drink it has never seen", () => {
    const v = resolveCupVisual({ drinkName: "Something Brand New", picked: [] });
    expect(v.liquid).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it("is case insensitive", () => {
    expect(resolveCupVisual({ drinkName: "TARO MILK TEA", picked: [] }).liquid).toBe(
      resolveCupVisual({ drinkName: "Taro Milk Tea", picked: [] }).liquid,
    );
  });
});

describe("resolveCupVisual — sugar and ice", () => {
  it("defaults to standard sugar and normal ice when nothing is picked", () => {
    const v = resolveCupVisual({ drinkName: "Original Milk Tea", picked: [] });
    expect(v.sugar).toBe(1);
    expect(v.ice).toBe("normal");
  });

  it.each([
    ["No Sugar", 0],
    ["Little Sugar (25%)", 0.25],
    ["Half Sugar", 0.5],
    ["Less Sugar (75%)", 0.75],
    ["Standard Sugar", 1],
  ])("maps %s", (name, expected) => {
    expect(resolveCupVisual({ drinkName: "x", picked: pick(name) }).sugar).toBe(expected);
  });

  it.each([
    ["No Ice", "none"],
    ["Less Ice", "less"],
    ["Normal Ice", "normal"],
    ["Warm", "warm"],
  ])("maps %s", (name, expected) => {
    expect(resolveCupVisual({ drinkName: "x", picked: pick(name) }).ice).toBe(expected);
  });

  it("does not mistake Less Sugar for Less Ice", () => {
    // Both contain "less"; only one of them is about ice.
    const v = resolveCupVisual({ drinkName: "x", picked: pick("Less Sugar (75%)") });
    expect(v.ice).toBe("normal");
    expect(v.sugar).toBe(0.75);
  });
});

describe("resolveCupVisual — toppings", () => {
  it("keeps only things that float in the cup", () => {
    const v = resolveCupVisual({
      drinkName: "Original Milk Tea",
      picked: pick("Standard Sugar", "Normal Ice", "Standard(Recommended)", "Pearls"),
    });
    expect(v.toppings.map((t) => t.name)).toEqual(["Pearls"]);
  });

  it("ignores an unrecognised modifier instead of throwing", () => {
    const v = resolveCupVisual({ drinkName: "x", picked: pick("Some Future Topping") });
    expect(v.toppings).toEqual([]);
  });

  it("drops anything the customer switched back off", () => {
    const v = resolveCupVisual({
      drinkName: "x",
      picked: [{ name: "Pearls", count: 0 }],
    });
    expect(v.toppings).toEqual([]);
  });

  it("carries the count through for multi-picks", () => {
    const v = resolveCupVisual({ drinkName: "x", picked: [{ name: "Pearls", count: 3 }] });
    expect(v.toppings[0].count).toBe(3);
  });

  it("treats cheese cream and brûlée as layers, not pieces", () => {
    // They cap the drink rather than sinking into it, so they must not join
    // the pile at the bottom.
    const v = resolveCupVisual({
      drinkName: "Oreo Brulee Milk Tea",
      picked: pick("Cheese Cream", "Brulee"),
    });
    expect(v.hasFoam).toBe(true);
    expect(v.hasBrulee).toBe(true);
    expect(v.toppings).toEqual([]);
  });
});

describe("describeCup", () => {
  it("says the build in plain words — this is what a screen reader gets", () => {
    const v = resolveCupVisual({
      drinkName: "Brown Sugar Milk Tea",
      picked: pick("Half Sugar", "Less Ice", "Pearls"),
    });
    expect(describeCup(v)).toBe("50% sugar, less ice, with Pearls");
  });

  it("names a warm drink as warm rather than as an ice level", () => {
    const v = resolveCupVisual({ drinkName: "x", picked: pick("Warm") });
    expect(describeCup(v)).toContain("served warm");
  });

  it("counts repeats", () => {
    const v = resolveCupVisual({ drinkName: "x", picked: [{ name: "Pearls", count: 2 }] });
    expect(describeCup(v)).toContain("Pearls ×2");
  });

  it("mentions the layers", () => {
    const v = resolveCupVisual({ drinkName: "x", picked: pick("Cheese Cream") });
    expect(describeCup(v)).toContain("cheese cream");
  });
});
