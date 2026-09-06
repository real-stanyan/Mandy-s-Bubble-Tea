// Customer note on the 50×80 photo label + the adaptive bottom band that
// makes room for it without ever cutting the modifier list short.
import { describe, it, expect } from "vitest";
import {
  renderPhotoCupLabel,
  layoutBottomBand,
  BAND_TIERS,
  BAND_TEXT_WIDTH,
  BOTTOM_BAND_Y,
  BOTTOM_BAND_HEIGHT,
  LABEL_HEIGHT_DOTS,
  NOTE_MAX_LINES,
} from "./render-zebra-cup";
import { NOTE_PREFIX, sanitizeLabelNote } from "./label-note";
import { POOL } from "../doodle/pool";

const base = {
  stickerNumber: "OL777",
  cupIdxOf: { idx: 1, total: 1 },
  drinkName: "Pearl Milk Tea",
  modifiersText: "Pearls(2)+Pudding -> L.Ice -> 50%S",
  doodleSvg: POOL[0].svg,
};

// The realistic "complex order": non-default milk, three toppings, less ice,
// less sugar — exactly what format-modifiers emits, one group per line.
const COMPLEX_MODS = "Oat Milk\nPearls(2) + Grass Jelly + Pudding\nLess Ice\nLess Sugar (50%)";
const COMPLEX_GROUPS = ["Oat Milk", "Pearls(2)", "Grass Jelly", "Pudding", "Less Ice", "Less Sugar (50%)"];

type BandField = { y: number; font: number; width: number; maxLines: number; gap: number; text: string; rows: number };

// Every left-aligned text field in the bottom band, in ZPL order.
function bandFields(zpl: string): BandField[] {
  const re = /^\^FO20,(\d+)\^A0N,(\d+),\d+\^FB(\d+),(\d+),(\d+),L,0\^FD(.*)\^FS$/;
  const out: BandField[] = [];
  for (const line of zpl.split("\n")) {
    const m = re.exec(line);
    if (!m) continue;
    const y = Number(m[1]);
    if (y < BOTTOM_BAND_Y) continue;
    out.push({
      y,
      font: Number(m[2]),
      width: Number(m[3]),
      maxLines: Number(m[4]),
      gap: Number(m[5]),
      text: m[6],
      rows: m[6].split("\\&").length,
    });
  }
  return out;
}

type BandInput = { drinkName: string; modifiersText: string; customerNote?: string | null };

// The stack must sit inside the band, above the bottom margin, in order and
// without overlaps — and never wider than the column left of the logo. The
// drink field's ^FB always allows 2 lines (the printer wraps), so its real
// height comes from the layout's own line estimate.
function expectWellStacked(zpl: string, input: BandInput): BandField[] {
  const fields = bandFields(zpl);
  const layout = layoutBottomBand(input.drinkName, input.modifiersText, sanitizeLabelNote(input.customerNote));
  expect(layout.height).toBeLessThanOrEqual(BOTTOM_BAND_HEIGHT);
  expect(fields.length).toBeGreaterThan(0);
  expect(fields[0].y).toBe(BOTTOM_BAND_Y + layout.drink.y);
  expect(fields[0].width).toBe(BAND_TEXT_WIDTH);
  let prevBottom = fields[0].y + layout.drink.lines.length * (fields[0].font + fields[0].gap);
  for (const f of fields.slice(1)) {
    expect(f.width).toBe(BAND_TEXT_WIDTH);
    expect(f.y).toBeGreaterThanOrEqual(prevBottom);
    expect(f.rows).toBe(f.maxLines); // pre-wrapped: the field asks for exactly its rows
    const bottom = f.y + f.rows * (f.font + f.gap);
    expect(bottom).toBeLessThanOrEqual(LABEL_HEIGHT_DOTS - 6);
    prevBottom = bottom;
  }
  return fields;
}

const flat = (f: BandField) => f.text.replace(/\\&/g, " ");

describe("customer note on the photo label", () => {
  it("prints the note under the modifiers with a 'Note:' prefix", async () => {
    const input = { ...base, customerNote: "No plastic straw please" };
    const { zpl } = await renderPhotoCupLabel(input);
    const fields = expectWellStacked(zpl, input);
    const noteField = fields.find((f) => flat(f).includes(`${NOTE_PREFIX}No plastic straw please`));
    const modsField = fields.find((f) => f.text.includes("Pearls(2)"));
    expect(noteField).toBeDefined();
    expect(modsField).toBeDefined();
    expect(noteField!.y).toBeGreaterThan(modsField!.y);
  });

  it("a simple order with a short note keeps the original sizes (32-dot modifiers, 28-dot note)", async () => {
    const { zpl } = await renderPhotoCupLabel({ ...base, customerNote: "Extra ice please" });
    const fields = bandFields(zpl);
    expect(fields.find((f) => f.text.includes("Pearls(2)"))!.font).toBe(BAND_TIERS[0].modFont);
    expect(fields.find((f) => f.text.startsWith(NOTE_PREFIX))!.font).toBe(BAND_TIERS[0].noteFont);
  });

  it("a complex order (milk + 3 toppings + less ice + less sugar) AND a two-line note all print in full", async () => {
    const input = {
      ...base,
      drinkName: "Brown Sugar Milk Tea",
      modifiersText: COMPLEX_MODS,
      customerNote: "Please write happy birthday Ana on the cup and no plastic straw",
    };
    const { zpl } = await renderPhotoCupLabel(input);
    const fields = expectWellStacked(zpl, input);
    for (const group of COMPLEX_GROUPS) expect(zpl).toContain(group);
    // Nothing in the band was cut short.
    for (const f of fields) expect(f.text).not.toContain("…");
    // The whole note survived (in one or more rows).
    const noteField = fields.find((f) => f.text.startsWith(NOTE_PREFIX))!;
    expect(flat(noteField)).toContain("happy birthday Ana");
    expect(flat(noteField)).toContain("no plastic straw");
    // Room was found by stepping the fonts down, not by dropping anything.
    expect(fields.find((f) => f.text.includes("Grass Jelly"))!.font).toBeLessThan(BAND_TIERS[0].modFont);
  });

  it("a complex order with no note also prints every modifier group (the old 5-line cap is gone)", async () => {
    const input = {
      ...base,
      drinkName: "Oreo Brulee Milk Tea",
      modifiersText: "Fresh Milk\nPudding + Green Apple Popping Pearls + Grass Jelly + Taro Balls\nLess Ice\n30% Sugar",
    };
    const { zpl } = await renderPhotoCupLabel(input);
    const fields = expectWellStacked(zpl, input);
    for (const f of fields) expect(f.text).not.toContain("…");
    expect(zpl).toContain("Taro Balls");
    expect(zpl).toContain("30% Sugar");
    expect(zpl).not.toContain(NOTE_PREFIX);
  });

  it("omits the note on keepsake copies, like the rest of the prep info", async () => {
    const { zpl } = await renderPhotoCupLabel({ ...base, customerNote: "No plastic straw", keepsake: true });
    expect(zpl).not.toContain(NOTE_PREFIX);
    expect(zpl).not.toContain("No plastic straw");
    expect(bandFields(zpl)).toHaveLength(0);
  });

  it("escapes ZPL control characters inside the note", async () => {
    const { zpl } = await renderPhotoCupLabel({ ...base, customerNote: "keep ^ 100% ~ hot \\ thanks" });
    const noteField = bandFields(zpl).find((f) => f.text.startsWith(NOTE_PREFIX))!;
    expect(flat(noteField)).toBe(`${NOTE_PREFIX}keep - 100% - hot / thanks`);
    expect(zpl).not.toMatch(/Note: keep \^/);
  });

  it("prints no note block when the note has nothing the printer font can draw", async () => {
    const { zpl } = await renderPhotoCupLabel({ ...base, customerNote: "少冰少糖 🧋" });
    expect(zpl).not.toContain(NOTE_PREFIX);
    expect(bandFields(zpl)).toHaveLength(2); // drink + modifiers only
  });

  it("caps an essay at three rows and ends it with an ellipsis", async () => {
    const input = {
      ...base,
      customerNote:
        "please make it extra sweet and extra creamy with lots of pearls and a big straw and write my name on it thanks a lot",
    };
    const { zpl } = await renderPhotoCupLabel(input);
    const fields = expectWellStacked(zpl, input);
    const noteField = fields.find((f) => f.text.startsWith(NOTE_PREFIX))!;
    expect(noteField.rows).toBeLessThanOrEqual(NOTE_MAX_LINES);
    expect(noteField.text.endsWith("…")).toBe(true);
  });

  it("a label without a note emits exactly two bottom-band fields (drink + modifiers), as before", async () => {
    const { zpl } = await renderPhotoCupLabel(base);
    const fields = bandFields(zpl);
    expect(fields).toHaveLength(2);
    expect(fields[0].text).toBe("Pearl Milk Tea");
    expect(fields[1].text).toContain("50%S");
  });
});

describe("layoutBottomBand", () => {
  it("fits inside the band for the everyday case at tier 0", () => {
    const l = layoutBottomBand("Pearl Milk Tea", "Pearls(2)+Pudding -> L.Ice -> 50%S", "");
    expect(l.tier).toBe(0);
    expect(l.height).toBeLessThanOrEqual(BOTTOM_BAND_HEIGHT);
    expect(l.note).toBeNull();
  });

  it("steps the tier down rather than truncating when a note joins a complex order", () => {
    const l = layoutBottomBand("Brown Sugar Milk Tea", COMPLEX_MODS, "Please write happy birthday Ana on the cup and no plastic straw");
    expect(l.tier).toBeGreaterThan(0);
    expect(l.height).toBeLessThanOrEqual(BOTTOM_BAND_HEIGHT);
    expect(l.mods!.lines.join(" ")).not.toContain("…");
    expect(l.note!.lines.join(" ")).toContain("no plastic straw");
  });

  it("shortens the note before it would ever touch the modifier list", () => {
    // Six modifier rows + a three-row note cannot fit even at the smallest
    // tier; the note gives up rows first and the modifiers stay whole.
    const sixRows = "Oat Milk\nPearls(2)\nGrass Jelly\nPudding\nLess Ice\nLess Sugar (50%)";
    const l = layoutBottomBand("Pearl Milk Tea", sixRows, "please write happy birthday Ana on the cup and no plastic straw thank you so much");
    expect(l.height).toBeLessThanOrEqual(BOTTOM_BAND_HEIGHT);
    expect(l.mods!.lines).toHaveLength(6);
    expect(l.mods!.lines.join(" ")).not.toContain("…");
    expect(l.note).not.toBeNull();
    expect(l.note!.lines.length).toBeLessThan(NOTE_MAX_LINES);
    expect(l.note!.lines[l.note!.lines.length - 1].endsWith("…")).toBe(true);
  });

  it("drops the note entirely before ellipsizing modifiers, and only ellipsizes when even that overflows", () => {
    const eightRows = "Oat Milk\nPearls(2)\nGrass Jelly\nPudding\nTaro Balls\nRed Bean\nLess Ice\nLess Sugar (50%)";
    const l = layoutBottomBand("Brown Sugar Milk Tea Frappe", eightRows, "no straw");
    expect(l.height).toBeLessThanOrEqual(BOTTOM_BAND_HEIGHT);
    expect(l.note).toBeNull();
    expect(l.tier).toBe(BAND_TIERS.length - 1);
    // The last-resort ellipsis is on the modifiers only when they alone overflow.
    const rows = l.mods!.lines;
    expect(rows.length).toBeLessThan(8);
    expect(rows[rows.length - 1].endsWith("…")).toBe(true);
  });
});
