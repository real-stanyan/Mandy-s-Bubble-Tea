// printer-client/src/zpl.test.ts
import { describe, it, expect } from "vitest";
import { renderStickerZPL } from "./zpl";

describe("renderStickerZPL", () => {
  const base = {
    stickerNumber: "OL812",
    orderTime: "21:35",
    drinkName: "Brown Sugar Milk Tea",
    toppings: ["Pearls"],
    ice: "Less Ice",
    sugar: "Half Sugar",
    cupIndex: 1,
    cupTotal: 2,
    priceCents: 700,
    customerName: null,
  };

  it("produces a ZPL string with ^XA start and ^XZ end", () => {
    const z = renderStickerZPL(base);
    expect(z.startsWith("^XA")).toBe(true);
    expect(z.endsWith("^XZ")).toBe(true);
  });

  it("includes sticker number, time, drink name, modifiers, cup index, and price", () => {
    const z = renderStickerZPL(base);
    expect(z).toContain("OL812");
    expect(z).toContain("21:35");
    expect(z).toContain("Brown Sugar Milk Tea");
    expect(z).toContain("Pearls -> Less Ice -> Half Sugar");
    expect(z).toContain("1/2");
    expect(z).toContain("$7.00");
  });

  it("joins multiple toppings with '+'", () => {
    const z = renderStickerZPL({ ...base, toppings: ["Pearls", "Grass Jelly"] });
    expect(z).toContain("Pearls+Grass Jelly");
  });

  it("renders missing ice/sugar as empty between the '->' separators", () => {
    const z = renderStickerZPL({ ...base, ice: null, sugar: null });
    expect(z).toContain("Pearls ->  ->");
  });

  it("handles no toppings + present ice/sugar", () => {
    const z = renderStickerZPL({ ...base, toppings: [], ice: "Normal Ice", sugar: "Normal Sugar" });
    expect(z).toContain("-> Normal Ice -> Normal Sugar");
  });

  it("escapes ZPL metacharacters in drink name", () => {
    const z = renderStickerZPL({ ...base, drinkName: "Brown ^ Sugar ~ Milk" });
    expect(z).not.toContain("^ Sugar");
    expect(z).not.toContain("~ Milk");
  });

  it("formats price with two decimals even for round dollar amounts", () => {
    const z = renderStickerZPL({ ...base, priceCents: 500 });
    expect(z).toContain("$5.00");
  });

  it("handles long drink names via auto-wrap (smoke, length doesn't crash)", () => {
    const z = renderStickerZPL({
      ...base,
      drinkName: "Extra Large Brown Sugar Boba Milk Tea Deluxe Edition",
    });
    expect(z.startsWith("^XA")).toBe(true);
    expect(z).toContain("^FB");
  });

  it("renders customer first name when provided (web orders)", () => {
    const z = renderStickerZPL({ ...base, customerName: "Stan" });
    expect(z).toContain("Stan");
  });

  it("omits customer name row when null (POS orders)", () => {
    const withName = renderStickerZPL({ ...base, customerName: "Stan" });
    const noName = renderStickerZPL({ ...base, customerName: null });
    const foCount = (s: string) => (s.match(/\^FO/g) ?? []).length;
    // Name row adds exactly one ^FO to the label.
    expect(foCount(withName) - foCount(noName)).toBe(1);
  });

  it("renders short names at max height (48)", () => {
    const z = renderStickerZPL({ ...base, customerName: "Stan" });
    expect(z).toContain("^A0N,48,48");
    expect(z).toContain("Stan");
    expect(z).not.toContain("…");
  });

  it("shrinks medium-length names so they fit on one line without ellipsis", () => {
    const z = renderStickerZPL({ ...base, customerName: "Alexandrina" });
    // Should not be max height (too wide for 48), not be min (still fits
    // comfortably above 22). Any height between min+1 and max-1 is fine.
    const match = z.match(/\^A0N,(\d+),\1\^FDAlexandrina/);
    expect(match).not.toBeNull();
    const h = Number(match![1]);
    expect(h).toBeGreaterThan(22);
    expect(h).toBeLessThan(48);
    expect(z).not.toContain("…");
  });

  it("truncates only when even the min height cannot fit the full name", () => {
    const z = renderStickerZPL({
      ...base,
      customerName: "Bartholomew-Christopher-Maximilian",
    });
    expect(z).toContain("^A0N,22,22");
    expect(z).toContain("…");
  });

  it("appends an ellipsis when drink name is too long to fit", () => {
    const z = renderStickerZPL({
      ...base,
      drinkName: "Extra Large Brown Sugar Boba Milk Tea Deluxe Edition",
    });
    expect(z).toContain("…");
  });
});
