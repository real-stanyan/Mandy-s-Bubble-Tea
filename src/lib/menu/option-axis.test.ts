import { describe, expect, it } from "vitest";
import { axisKindFor, axisOptions, iceLevel, nearestIndex, shortLabel, sugarPercent } from "./option-axis";

// Catalog order as Square returns it (2026-09-06), deliberately unsorted.
const SUGAR = ["Standard Sugar", "Less Sugar (75%)", "Half Sugar", "Little Sugar (25%)", "No Sugar", "Extra Sugar"].map(
  (name) => ({ name }),
);
const ICE = ["Normal Ice", "Less Ice", "Extra Ice", "No Ice", "Warm"].map((name) => ({ name }));

describe("axis kind", () => {
  it("puts SUGAR and ICE lists (in every spelling Square has) on a slider", () => {
    expect(axisKindFor("SUGAR")).toBe("sugar");
    expect(axisKindFor("SUGAR LEVEL")).toBe("sugar");
    expect(axisKindFor("ICE")).toBe("ice");
    expect(axisKindFor("Ice Level")).toBe("ice");
  });

  it("leaves toppings, milk and size as they are", () => {
    expect(axisKindFor("TOPPING")).toBeNull();
    expect(axisKindFor("ALTERNATIVE MILK")).toBeNull();
    expect(axisKindFor("SIZE")).toBeNull();
    expect(axisKindFor(undefined)).toBeNull();
  });
});

describe("sugar axis", () => {
  it("orders the real options from none to extra", () => {
    expect(axisOptions("sugar", SUGAR).map((o) => o.option.name)).toEqual([
      "No Sugar",
      "Little Sugar (25%)",
      "Half Sugar",
      "Less Sugar (75%)",
      "Standard Sugar",
      "Extra Sugar",
    ]);
  });

  it("labels ticks as percentages", () => {
    expect(axisOptions("sugar", SUGAR).map((o) => o.short)).toEqual(["0%", "25%", "50%", "75%", "100%", "125%"]);
  });

  it("copes with a drink that offers fewer levels", () => {
    const two = [{ name: "Standard Sugar" }, { name: "Half Sugar" }];
    expect(axisOptions("sugar", two).map((o) => o.short)).toEqual(["50%", "100%"]);
  });

  it("reads the percentage from the name, whichever wording Square used", () => {
    expect(sugarPercent("Less Sugar (75%)")).toBe(75);
    expect(sugarPercent("Little Sugar (25%)")).toBe(25);
    expect(sugarPercent("No Sugar")).toBe(0);
    expect(sugarPercent("Normal Ice")).toBeNull();
  });
});

describe("ice axis", () => {
  it("runs warm → none → less → normal → extra", () => {
    expect(axisOptions("ice", ICE).map((o) => o.short)).toEqual(["Warm", "None", "Less", "Normal", "Extra"]);
    expect(iceLevel("Warm")).toBe(-1);
    expect(iceLevel("Half Sugar")).toBeNull();
  });

  it("keeps a name it does not recognise, after the known ones", () => {
    const opts = axisOptions("ice", [...ICE, { name: "Slushie" }]);
    expect(opts[opts.length - 1]?.short).toBe("Slushie");
    expect(shortLabel("ice", "Slushie")).toBe("Slushie");
  });
});

describe("nearest index", () => {
  it("rounds to the closest tick", () => {
    expect(nearestIndex(1.4, 5)).toBe(1);
    expect(nearestIndex(1.6, 5)).toBe(2);
    expect(nearestIndex(-3, 5)).toBe(0);
    expect(nearestIndex(9, 5)).toBe(4);
  });

  it("skips a disabled tick towards the side the pointer came from", () => {
    const disabled = [true, false, false, false, false];
    expect(nearestIndex(0.2, 5, disabled)).toBe(1);
    const mid = [false, false, true, false, false];
    expect(nearestIndex(1.8, 5, mid)).toBe(1);
    expect(nearestIndex(2.2, 5, mid)).toBe(3);
  });
});
