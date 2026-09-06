import { describe, expect, it } from "vitest";
import { isMilkList, milkDisplayName, milkIdentity } from "./milk-identity";

// The production ALTERNATIVE MILK list, catalog order, 2026-09-06.
const CATALOG = ["Standard(Recommended)", "Fresh Milk", "Soy Milk", "Oat Milk", "Almond Milk"];

describe("milk identity", () => {
  it("knows every milk on the menu by name — none falls back to the plain carton", () => {
    expect(CATALOG.filter((n) => milkIdentity(n).key === "unknown")).toEqual([]);
  });

  it("gives each a distinct face", () => {
    const faces = new Set(CATALOG.map((n) => `${milkIdentity(n).glyph}/${milkIdentity(n).band}`));
    expect(faces.size).toBe(CATALOG.length);
  });

  it("recommends exactly the house default and explains it", () => {
    expect(CATALOG.filter((n) => milkIdentity(n).recommended)).toEqual(["Standard(Recommended)"]);
    expect(milkIdentity("Standard(Recommended)").blurb).toMatch(/milk powder/i);
  });

  it("sorts dairy from plant", () => {
    expect(milkIdentity("Fresh Milk").kind).toBe("dairy");
    expect(milkIdentity("Standard(Recommended)").kind).toBe("dairy");
    for (const n of ["Soy Milk", "Oat Milk", "Almond Milk"]) expect(milkIdentity(n).kind).toBe("plant");
  });

  it("draws plain fresh milk as a bottle, the rest as cartons", () => {
    expect(milkIdentity("Fresh Milk").glyph).toBe("bottle");
    expect(milkIdentity("Oat Milk").glyph).toBe("oat");
  });

  it("falls back to a plain carton for a name it has never seen", () => {
    const id = milkIdentity("Camel Milk");
    expect(id.key).toBe("unknown");
    expect(id.glyph).toBe("carton");
    expect(id.recommended).toBe(false);
  });

  it("spots the milk list and nothing else", () => {
    expect(isMilkList("ALTERNATIVE MILK")).toBe(true);
    expect(isMilkList("SUGAR LEVEL")).toBe(false);
    expect(isMilkList("TOPPING")).toBe(false);
    expect(isMilkList(null)).toBe(false);
  });

  it("drops the parenthetical from the card name", () => {
    expect(milkDisplayName("Standard(Recommended)")).toBe("Standard");
    expect(milkDisplayName("Oat Milk")).toBe("Oat Milk");
  });
});
