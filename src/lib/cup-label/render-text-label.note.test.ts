// Customer note on the 40×30 text-only label (the small-paper fallback mode).
import { describe, it, expect } from "vitest";
import { renderTextCupLabel, TEXT_LABEL_HEIGHT_DOTS } from "./render-text-label";
import { NOTE_PREFIX } from "./label-note";

const base = {
  stickerNumber: "OL999",
  cupIdxOf: { idx: 1, total: 2 },
  drinkName: "Pearl Milk Tea",
  modifiersText: "Pearls(2)+Pudding -> L.Ice -> 50%S",
  doodleSvg: "",
};

function bodyField(zpl: string): string {
  return zpl.split("\n").find((l) => l.includes(NOTE_PREFIX) || l.includes("\\&"))!;
}

describe("customer note on the text label", () => {
  it("prints the note as the last group under the modifiers", async () => {
    const { zpl } = await renderTextCupLabel({ ...base, customerNote: "No plastic straw" });
    const field = bodyField(zpl);
    const rows = /\^FD(.*)\^FS/.exec(field)![1].split("\\&");
    expect(rows[rows.length - 1]).toBe(`${NOTE_PREFIX}No plastic straw`);
    expect(rows[0]).toContain("Pearls(2)");
  });

  const COMPLEX = "Oat Milk\nPearls(2) + Grass Jelly + Pudding\nLess Ice\nLess Sugar (50%)";
  const GROUPS = ["Oat Milk", "Grass Jelly", "Pudding", "Less Ice", "Less Sugar (50%)"];

  function expectAboveBottomMargin(field: string) {
    const y = Number(/\^FO\d+,(\d+)/.exec(field)![1]);
    const font = Number(/\^A0N,(\d+),/.exec(field)![1]);
    const rows = /\^FD(.*)\^FS/.exec(field)![1].split("\\&").length;
    expect(y + rows * (font + 2)).toBeLessThanOrEqual(TEXT_LABEL_HEIGHT_DOTS - 24);
  }

  it("a complex order (milk + 3 toppings + less ice + less sugar) plus a short note all fit by stepping the fonts down", async () => {
    const { zpl } = await renderTextCupLabel({ ...base, modifiersText: COMPLEX, customerNote: "No straw" });
    for (const group of GROUPS) expect(zpl).toContain(group);
    expect(zpl).toContain(`${NOTE_PREFIX}No straw`);
    expect(zpl).not.toContain("…");
    const field = bodyField(zpl);
    expect(field).toContain("^A0N,24,24"); // smallest modifier tier
    // Six rows only fit once the drink name also steps down from its natural 52.
    const drinkField = zpl.split("\n").find((l) => l.includes("Pearl Milk Tea"))!;
    expect(drinkField).not.toContain("^A0N,52,52");
    expectAboveBottomMargin(field);
  });

  it("when even 24-dot cannot hold a complex order AND a long note, the note is what gets cut — never a modifier", async () => {
    const { zpl } = await renderTextCupLabel({
      ...base,
      modifiersText: COMPLEX,
      customerNote: "write happy birthday on the cup and add a candle",
    });
    // Every prep detail, including the last-line sugar level, survived.
    for (const group of GROUPS) expect(zpl).toContain(group);
    const field = bodyField(zpl);
    const rows = /\^FD(.*)\^FS/.exec(field)![1].split("\\&");
    expect(rows[rows.length - 1].endsWith("…")).toBe(true); // something (the note) was dropped
    expect(rows.join(" ")).toContain("Less Sugar (50%)");
    expectAboveBottomMargin(field);
  });

  it("omits the note on keepsake copies", async () => {
    const { zpl } = await renderTextCupLabel({ ...base, customerNote: "No plastic straw", keepsake: true });
    expect(zpl).not.toContain(NOTE_PREFIX);
  });

  it("drops characters the printer font cannot draw and skips an empty note", async () => {
    const { zpl } = await renderTextCupLabel({ ...base, customerNote: "少冰 🧋" });
    expect(zpl).not.toContain(NOTE_PREFIX);
  });
});
