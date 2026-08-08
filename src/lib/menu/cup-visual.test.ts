import { describe, expect, it } from "vitest";
import { resolveCupVisual, describeCup } from "./cup-visual";

/**
 * The rule this pins: the cup reflects what the customer actually picked, and
 * anything it doesn't recognise is skipped rather than guessed at.
 *
 * The mapping is by modifier NAME because ids are Square's and churn whenever
 * the catalog is rebuilt. That makes the name tables the fragile part — a
 * renamed topping silently stops drawing — so every case Stan reported on
 * 2026-08-08 is pinned below, along with the substring collisions that caused
 * them.
 */

const pick = (...names: string[]) => names.map((name) => ({ name, count: 1 }));
const liquidOf = (drinkName: string) => resolveCupVisual({ drinkName, picked: [] }).liquid;

describe("liquid — substring collisions", () => {
  it("grapefruit is not grape", () => {
    // The reported bug: "Grapefruit Iced Green Tea" drew purple because
    // "Grapefruit" contains "grape". Both drinks are on the real menu.
    expect(liquidOf("Grapefruit Iced Green Tea")).not.toBe(liquidOf("Grape Iced Green Tea"));
    expect(liquidOf("Grapefruit Black Tea")).not.toBe(liquidOf("Grape Black Tea"));
  });

  it("grapefruit is orange-red, not purple", () => {
    // Pinning the hue family rather than the exact hex: red channel must
    // dominate blue, which is the whole difference from grape.
    const hex = liquidOf("Grapefruit Slushy");
    const r = parseInt(hex.slice(1, 3), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    expect(r).toBeGreaterThan(b + 60);
  });

  it("honeydew is not honey", () => {
    expect(liquidOf("Honeydew Milk Tea")).not.toBe(liquidOf("Honey Black Tea"));
  });

  it("honey citron and honey ginger are not plain honey", () => {
    expect(liquidOf("Honey Citron Tea")).not.toBe(liquidOf("Honey Green Tea"));
    expect(liquidOf("Honey Ginger Tea")).not.toBe(liquidOf("Honey Green Tea"));
  });

  it("wintermelon is not watermelon", () => {
    expect(liquidOf("Wintermelon Tea")).not.toBe(liquidOf("Watermelon Slushy"));
  });

  it("green apple is not green tea", () => {
    expect(liquidOf("Green Apple Green Tea")).not.toBe(liquidOf("Jasmine Green Tea"));
  });
});

describe("liquid — flavour beats the base it is built on", () => {
  it.each([
    "Yakult Green Tea",
    "Mango Iced Green Tea",
    "Lychee Black Tea",
    "Taro Milk Tea",
    "Coffee Milk Tea",
  ])("%s does not fall back to its base tea", (name) => {
    const base = name.includes("Green Tea")
      ? "Jasmine Green Tea"
      : name.includes("Black Tea")
        ? "Ceylon Black Tea"
        : "Original Milk Tea";
    expect(liquidOf(name)).not.toBe(liquidOf(base));
  });

  it("gives the top seller its own colour", () => {
    expect(liquidOf("Brown Sugar Milk Tea")).not.toBe(liquidOf("Original Milk Tea"));
  });

  it("falls back to milk tea for a drink it has never seen", () => {
    expect(liquidOf("Something Brand New")).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it("is case insensitive", () => {
    expect(liquidOf("TARO MILK TEA")).toBe(liquidOf("Taro Milk Tea"));
  });
});

describe("toppings — the real Square modifier list", () => {
  it.each([
    "Coffee Jelly",
    "Green Apple Popping (New)",
    "Chocolate Popping (New)",
    "Oat Popping (New)",
    "Grape Jelly",
    "Rainbow Jelly",
    "Sago",
    "Pearls",
    "Oreo",
  ])("draws %s", (name) => {
    const v = resolveCupVisual({ drinkName: "Original Milk Tea", picked: pick(name) });
    expect(v.toppings).toHaveLength(1);
    expect(v.toppings[0].colors.length).toBeGreaterThan(0);
  });

  it("gives rainbow jelly more than one colour", () => {
    const v = resolveCupVisual({ drinkName: "x", picked: pick("Rainbow Jelly") });
    expect(v.toppings[0].colors.length).toBeGreaterThan(3);
  });

  it("keeps every other topping to a single colour", () => {
    const v = resolveCupVisual({ drinkName: "x", picked: pick("Coffee Jelly") });
    expect(v.toppings[0].colors).toHaveLength(1);
  });

  it("floats oreo on top instead of sinking it", () => {
    const v = resolveCupVisual({ drinkName: "x", picked: pick("Oreo") });
    expect(v.toppings[0].placement).toBe("top");
    expect(v.toppings[0].shape).toBe("crumb");
  });

  it("sinks everything else", () => {
    const v = resolveCupVisual({ drinkName: "x", picked: pick("Pearls", "Coffee Jelly") });
    expect(v.toppings.every((t) => t.placement === "bottom")).toBe(true);
  });

  it("does not mistake Oat Popping for Oat Milk", () => {
    const popping = resolveCupVisual({ drinkName: "x", picked: pick("Oat Popping (New)") });
    const milk = resolveCupVisual({ drinkName: "x", picked: pick("Oat Milk") });
    expect(popping.toppings).toHaveLength(1);
    expect(milk.toppings).toHaveLength(0);
  });

  it.each(["Fresh Milk", "Soy Milk", "Almond Milk", "Oat Milk"])(
    "does not draw %s as a piece — it changes the drink, not the bottom of it",
    (name) => {
      expect(resolveCupVisual({ drinkName: "x", picked: pick(name) }).toppings).toEqual([]);
    },
  );

  it("keeps only things that float in the cup", () => {
    const v = resolveCupVisual({
      drinkName: "Original Milk Tea",
      picked: pick("Standard Sugar", "Normal Ice", "Standard(Recommended)", "Pearls"),
    });
    expect(v.toppings.map((t) => t.name)).toEqual(["Pearls"]);
  });

  it("ignores an unrecognised modifier instead of throwing", () => {
    expect(resolveCupVisual({ drinkName: "x", picked: pick("Some Future Topping") }).toppings)
      .toEqual([]);
  });

  it("drops anything the customer switched back off", () => {
    const v = resolveCupVisual({ drinkName: "x", picked: [{ name: "Pearls", count: 0 }] });
    expect(v.toppings).toEqual([]);
  });

  it("carries the count through — it drives how deep the bed is", () => {
    const v = resolveCupVisual({ drinkName: "x", picked: [{ name: "Pearls", count: 3 }] });
    expect(v.toppings[0].count).toBe(3);
  });

  it("treats cheese cream and brûlée as layers, not pieces", () => {
    const v = resolveCupVisual({
      drinkName: "Oreo Brulee Milk Tea",
      picked: pick("Cheese Cream", "Brulee"),
    });
    expect(v.hasFoam).toBe(true);
    expect(v.hasBrulee).toBe(true);
    expect(v.toppings).toEqual([]);
  });
});

describe("sugar and ice", () => {
  it("defaults to standard sugar and normal ice", () => {
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
    ["Extra Sugar", 1.25],
  ])("maps %s", (name, expected) => {
    expect(resolveCupVisual({ drinkName: "x", picked: pick(name) }).sugar).toBe(expected);
  });

  it.each([
    ["No Ice", "none"],
    ["Less Ice", "less"],
    ["Normal Ice", "normal"],
    ["Extra Ice", "extra"],
    ["Warm", "warm"],
  ])("maps %s", (name, expected) => {
    expect(resolveCupVisual({ drinkName: "x", picked: pick(name) }).ice).toBe(expected);
  });

  it("does not mistake Less Sugar for Less Ice", () => {
    const v = resolveCupVisual({ drinkName: "x", picked: pick("Less Sugar (75%)") });
    expect(v.ice).toBe("normal");
    expect(v.sugar).toBe(0.75);
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
    expect(describeCup(resolveCupVisual({ drinkName: "x", picked: pick("Warm") })))
      .toContain("served warm");
  });

  it("counts repeats", () => {
    const v = resolveCupVisual({ drinkName: "x", picked: [{ name: "Pearls", count: 2 }] });
    expect(describeCup(v)).toContain("Pearls ×2");
  });

  it("mentions the layers", () => {
    expect(describeCup(resolveCupVisual({ drinkName: "x", picked: pick("Cheese Cream") })))
      .toContain("cheese cream");
  });
});
