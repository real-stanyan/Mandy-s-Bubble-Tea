import { describe, expect, it } from "vitest";
import { TOPPING_GROUP_ORDER, groupToppings, toppingIdentity } from "./topping-identity";

// The production TOPPING list, catalog order, 2026-09-06.
const CATALOG = [
  "Pearls",
  "Pudding",
  "Mango Jelly",
  "Lychee Jelly",
  "Rainbow Jelly",
  "Herbal Jelly",
  "Grape Jelly",
  "Coffee Jelly",
  "Aloe Vera",
  "Jelly Ball",
  "Sago",
  "Oreo",
  "Cheese Cream",
  "Brulee",
  "Strawberry Popping",
  "Green Apple Popping (New)",
  "Oat Popping (New)",
  "Chocolate Popping (New)",
];

describe("topping identity", () => {
  it("knows every topping on the menu by name — none falls back to the neutral tile", () => {
    expect(CATALOG.filter((n) => toppingIdentity(n).key === "unknown")).toEqual([]);
  });

  it("gives each of them a distinct face (glyph + colour)", () => {
    const faces = new Set(CATALOG.map((n) => `${toppingIdentity(n).glyph}/${toppingIdentity(n).color}`));
    expect(faces.size).toBe(CATALOG.length);
  });

  it("matches the longest name first", () => {
    expect(toppingIdentity("Oat Popping (New)").key).toBe("oat popping");
    expect(toppingIdentity("Jelly Ball").key).toBe("jelly ball");
    expect(toppingIdentity("Grape Jelly").key).toBe("grape jelly");
  });

  it("agrees with the cup preview on shapes", () => {
    expect(toppingIdentity("Pearls").glyph).toBe("pearl");
    expect(toppingIdentity("Herbal Jelly").glyph).toBe("cube");
    expect(toppingIdentity("Oreo").glyph).toBe("crumb");
    expect(toppingIdentity("Cheese Cream").glyph).toBe("foam");
    expect(toppingIdentity("Brulee").glyph).toBe("brulee");
    expect(toppingIdentity("Rainbow Jelly").colors?.length).toBeGreaterThan(3);
  });

  it("gives light toppings a darker edge so they still read on paper", () => {
    for (const n of ["Sago", "Lychee Jelly", "Aloe Vera", "Cheese Cream", "Oat Popping (New)"]) {
      const id = toppingIdentity(n);
      expect(id.edge).not.toBe(id.color);
    }
  });

  it("falls back to a neutral cube for a name it has never seen", () => {
    const id = toppingIdentity("Dragon Scale Bits");
    expect(id.key).toBe("unknown");
    expect(id.group).toBe("other");
    expect(id.glyph).toBe("cube");
  });
});

describe("grouping", () => {
  const groups = groupToppings(CATALOG.map((name) => ({ name })));

  it("orders groups chewy → popping → jelly → creamy → crunch and drops empty ones", () => {
    expect(groups.map((g) => g.group)).toEqual(["chewy", "popping", "jelly", "creamy", "crunch"]);
    expect(TOPPING_GROUP_ORDER[0]).toBe("chewy");
  });

  it("keeps catalog order inside a group", () => {
    const jelly = groups.find((g) => g.group === "jelly")!.items.map((i) => i.option.name);
    expect(jelly).toEqual(["Mango Jelly", "Lychee Jelly", "Rainbow Jelly", "Herbal Jelly", "Grape Jelly", "Coffee Jelly", "Aloe Vera"]);
  });

  it("accounts for every option exactly once", () => {
    const all = groups.flatMap((g) => g.items.map((i) => i.option.name));
    expect(all.sort()).toEqual([...CATALOG].sort());
  });
});
