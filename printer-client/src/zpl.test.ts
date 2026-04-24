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
    expect(z).toContain("Pearls -> L.Ice -> 50%S");
    expect(z).toContain("1/2");
    expect(z).toContain("$7.00");
  });

  it("joins multiple toppings with '+'", () => {
    const z = renderStickerZPL({ ...base, toppings: ["Pearls", "Grass Jelly"] });
    expect(z).toContain("Pearls+Grass Jelly");
  });

  it("omits missing ice/sugar rather than printing empty separators", () => {
    const z = renderStickerZPL({ ...base, ice: null, sugar: null });
    expect(z).toContain("Pearls");
    expect(z).not.toContain("->  ->");
    expect(z).not.toContain("Pearls ->");
  });

  it("omits default Normal Ice / Standard Sugar / Standard(Recommended) from the sticker", () => {
    const z = renderStickerZPL({ ...base, toppings: [], ice: "Normal Ice", sugar: "Standard Sugar" });
    expect(z).not.toContain("Normal Ice");
    expect(z).not.toContain("Standard Sugar");
  });

  it("keeps non-default sugar when ice is Normal (long modifier list)", () => {
    const z = renderStickerZPL({
      ...base,
      toppings: ["Strawberry Popping", "Aloe Vera", "Oreo"],
      ice: "Normal Ice",
      sugar: "Half Sugar",
    });
    expect(z).toContain("Strawberry Popping+Aloe Vera+Oreo -> 50%S");
    expect(z).not.toContain("Normal Ice");
    expect(z).not.toContain("…");
  });

  it("maps known ice levels to compact shorthand", () => {
    expect(renderStickerZPL({ ...base, ice: "Less Ice", sugar: "Standard Sugar" })).toContain("L.Ice");
    expect(renderStickerZPL({ ...base, ice: "Extra Ice", sugar: "Standard Sugar" })).toContain("E.Ice");
    expect(renderStickerZPL({ ...base, ice: "No Ice", sugar: "Standard Sugar" })).toContain("N.Ice");
    expect(renderStickerZPL({ ...base, ice: "Warm", sugar: "Standard Sugar" })).toContain("Warm");
  });

  it("maps known sugar levels to percentage shorthand", () => {
    expect(renderStickerZPL({ ...base, ice: "Normal Ice", sugar: "Less Sugar (75%)" })).toContain("75%S");
    expect(renderStickerZPL({ ...base, ice: "Normal Ice", sugar: "Half Sugar" })).toContain("50%S");
    expect(renderStickerZPL({ ...base, ice: "Normal Ice", sugar: "Little Sugar (25%)" })).toContain("25%S");
    expect(renderStickerZPL({ ...base, ice: "Normal Ice", sugar: "No Sugar" })).toContain("0%S");
    expect(renderStickerZPL({ ...base, ice: "Normal Ice", sugar: "Extra Sugar" })).toContain("+S");
  });

  it("fits 3 max-count toppings + non-default ice + non-default sugar without truncation", () => {
    const z = renderStickerZPL({
      ...base,
      toppings: ["Pearl x10", "Oreo x10", "Pudding x10"],
      ice: "Less Ice",
      sugar: "Half Sugar",
    });
    expect(z).toContain("Pearl x10+Oreo x10+Pudding x10 -> L.Ice -> 50%S");
    expect(z).not.toContain("…");
  });

  it("fits milk alternative + toppings + non-default ice/sugar", () => {
    const z = renderStickerZPL({
      ...base,
      toppings: ["Oat Milk", "Pearls", "Pudding x2"],
      ice: "Less Ice",
      sugar: "Half Sugar",
    });
    expect(z).toContain("Oat Milk+Pearls+Pudding x2 -> L.Ice -> 50%S");
    expect(z).not.toContain("…");
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

  it("bottom-anchors the footer so cup count + price always print", () => {
    // Label is 240 dots tall. The footer (H_FOOT=22) must land in the
    // bottom strip regardless of what goes above it. Pull the ^FO Y
    // coordinate of the two footer fields from the emitted ZPL and
    // assert they are within the last ~30 dots of the label.
    const z = renderStickerZPL(base);
    const cupFo = z.match(/\^FO\d+,(\d+)\^A0N,\d+,\d+\^FD1\/2/);
    const priceFo = z.match(/\^FO\d+,(\d+)\^A0N,\d+,\d+\^FB[^^]+\^FD\$7\.00/);
    expect(cupFo).not.toBeNull();
    expect(priceFo).not.toBeNull();
    const cupY = Number(cupFo![1]);
    const priceY = Number(priceFo![1]);
    expect(cupY).toBe(priceY);
    expect(cupY).toBeGreaterThan(205);
    expect(cupY).toBeLessThan(225);
  });

  it("appends an ellipsis when drink name is too long to fit", () => {
    const z = renderStickerZPL({
      ...base,
      drinkName: "Extra Large Brown Sugar Boba Milk Tea Deluxe Edition",
    });
    expect(z).toContain("…");
  });
});
