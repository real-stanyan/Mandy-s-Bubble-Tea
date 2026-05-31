import { describe, it, expect } from "vitest";
import type { OrderLineItem } from "square";
import { formatModifiersForLabel } from "./format-modifiers";

function line(modifiers: Array<{ name: string; quantity?: string }>): OrderLineItem {
  return {
    name: "Test Drink",
    quantity: "1",
    modifiers: modifiers.map((m) => ({ catalogObjectId: "MOD", ...m })),
  } as OrderLineItem;
}

describe("formatModifiersForLabel — full names (no abbreviations)", () => {
  it("renders ice levels with their full Square names", () => {
    expect(formatModifiersForLabel(line([{ name: "Less Ice" }]))).toBe("Less Ice");
    expect(formatModifiersForLabel(line([{ name: "Extra Ice" }]))).toBe("Extra Ice");
    expect(formatModifiersForLabel(line([{ name: "No Ice" }]))).toBe("No Ice");
    expect(formatModifiersForLabel(line([{ name: "Warm" }]))).toBe("Warm");
  });

  it("renders sugar levels with their full Square names, keeping the percentage", () => {
    expect(formatModifiersForLabel(line([{ name: "Less Sugar (75%)" }]))).toBe("Less Sugar (75%)");
    expect(formatModifiersForLabel(line([{ name: "Half Sugar" }]))).toBe("Half Sugar");
    expect(formatModifiersForLabel(line([{ name: "Little Sugar (25%)" }]))).toBe("Little Sugar (25%)");
    expect(formatModifiersForLabel(line([{ name: "No Sugar" }]))).toBe("No Sugar");
    expect(formatModifiersForLabel(line([{ name: "Extra Sugar" }]))).toBe("Extra Sugar");
  });

  it("still omits default ice/sugar levels", () => {
    expect(formatModifiersForLabel(line([{ name: "Normal Ice" }, { name: "Standard Sugar" }]))).toBe("");
  });

  it("keeps toppings as full names with aggregation, then ice then sugar, each on its own line", () => {
    const out = formatModifiersForLabel(
      line([
        { name: "Pearls", quantity: "2" },
        { name: "Pudding" },
        { name: "Less Ice" },
        { name: "Half Sugar" },
      ]),
    );
    expect(out).toBe("Pearls(2) + Pudding\nLess Ice\nHalf Sugar");
  });

  it("prepends non-default milk substitution", () => {
    const out = formatModifiersForLabel(
      line([{ name: "Oat Milk" }, { name: "Pearls" }, { name: "Less Sugar (75%)" }]),
    );
    expect(out).toBe("Oat Milk\nPearls\nLess Sugar (75%)");
  });
});
