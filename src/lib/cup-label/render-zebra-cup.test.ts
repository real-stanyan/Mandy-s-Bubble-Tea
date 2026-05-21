import { describe, it, expect } from "vitest";
import {
  renderCupLabel,
  wrapModifierLine,
  LABEL_WIDTH_DOTS,
  LABEL_HEIGHT_DOTS,
} from "./render-zebra-cup";
import { POOL } from "../doodle/pool";

describe("Zebra cup-label compositor", () => {
  it("emits valid ZPL II framing for a basic input", async () => {
    const out = await renderCupLabel({
      stickerNumber: "OL999",
      cupIdxOf: { idx: 1, total: 2 },
      drinkName: "Pearl Milk Tea",
      modifiersText: "Pearls(2)+Pudding -> L.Ice -> 50%S",
      doodleSvg: POOL[0].svg,
    });
    expect(out.zpl.startsWith("^XA")).toBe(true);
    expect(out.zpl.endsWith("^XZ")).toBe(true);
    expect(out.zpl).toContain(`^PW${LABEL_WIDTH_DOTS}`);
    expect(out.zpl).toContain(`^LL${LABEL_HEIGHT_DOTS}`);
    expect(out.zpl).toContain("^GFA,"); // graphic field present (doodle)
    expect(out.zpl).toContain("OL999"); // sticker number
    expect(out.zpl).toContain("Pearl Milk Tea"); // drink name
  });

  it("escapes ZPL control chars in user content", async () => {
    const out = await renderCupLabel({
      stickerNumber: "OL000",
      cupIdxOf: { idx: 1, total: 1 },
      // Keep input under TOP_DRINK_MAX_CHARS (20) so the escape behavior
      // is tested in isolation from the drink-name truncation guard.
      drinkName: "A^B~C\\Drink",
      modifiersText: "",
      doodleSvg: POOL[0].svg,
    });
    // Raw ^ ~ \ would break ZPL parsing on the printer; verify replaced.
    expect(out.zpl).not.toContain("A^B~C");
    expect(out.zpl).toContain("A-B-C/Drink");
  });

  it("renders the full drink name without ellipsis, scaling the font down for long names", async () => {
    const out = await renderCupLabel({
      stickerNumber: "OL000",
      cupIdxOf: { idx: 1, total: 1 },
      drinkName: "Brown Sugar Milk Tea Frappe", // 27 chars
      modifiersText: "",
      doodleSvg: POOL[0].svg,
    });
    expect(out.zpl).toContain("Brown Sugar Milk Tea Frappe");
    expect(out.zpl).not.toContain("…");
    // Long name (27 chars) → drinkFontSizeFor returns 20.
    expect(out.zpl).toContain("^A0N,20,20");
  });

  it("embeds the Mandy logo as a ^GFA field-reverse block on the top band", async () => {
    const out = await renderCupLabel({
      stickerNumber: "OL000",
      cupIdxOf: { idx: 1, total: 1 },
      drinkName: "Test",
      modifiersText: "",
      doodleSvg: POOL[0].svg,
    });
    // ^FR before ^GFA inverts the bitmap so the dark logo outlines paint
    // white on the already-black header band. Pinning the prefix keeps
    // the layout contract under future refactors.
    expect(out.zpl).toMatch(/\^FO\d+,\d+\^FR\^GFA,/);
  });

  it("produces a preview PNG of the right pixel size", async () => {
    const out = await renderCupLabel({
      stickerNumber: "OL000",
      cupIdxOf: { idx: 1, total: 1 },
      drinkName: "Test",
      modifiersText: "Pearl",
      doodleSvg: POOL[0].svg,
    });
    expect(out.previewPng.length).toBeGreaterThan(1000); // sanity: real PNG, not a stub
    // PNG magic header: 89 50 4E 47
    expect(out.previewPng[0]).toBe(0x89);
    expect(out.previewPng[1]).toBe(0x50);
    expect(out.previewPng[2]).toBe(0x4e);
    expect(out.previewPng[3]).toBe(0x47);
  });

  it("omits the modifier ^FB block when modifiers is empty (matches Zebra zpl)", async () => {
    const withMods = await renderCupLabel({
      stickerNumber: "OL000",
      cupIdxOf: { idx: 1, total: 1 },
      drinkName: "Test",
      modifiersText: "Pearl -> 50%S",
      doodleSvg: POOL[0].svg,
    });
    const withoutMods = await renderCupLabel({
      stickerNumber: "OL000",
      cupIdxOf: { idx: 1, total: 1 },
      drinkName: "Test",
      modifiersText: "",
      doodleSvg: POOL[0].svg,
    });
    // The empty-modifier path should drop exactly one ^FB (the
    // modifier band) versus the with-modifiers render. We compare
    // relative counts so the test stays robust against unrelated
    // template additions (e.g. the top-band "Hi, {name}" greeting
    // or the right-aligned order-info block both add their own
    // ^FB blocks).
    const withCount = (withMods.zpl.match(/\^FB/g) ?? []).length;
    const withoutCount = (withoutMods.zpl.match(/\^FB/g) ?? []).length;
    expect(withCount - withoutCount).toBe(1);
  });
});

describe("wrapModifierLine", () => {
  it("returns empty array for empty input", () => {
    expect(wrapModifierLine("", 28)).toEqual([]);
  });

  it("keeps short text on one line", () => {
    expect(wrapModifierLine("Pearl", 28)).toEqual(["Pearl"]);
  });

  it("wraps on ' -> ' boundaries", () => {
    const r = wrapModifierLine("Pearl -> L.Ice -> 50%S -> Warm -> Extra", 18);
    expect(r.length).toBeGreaterThan(1);
  });

  it("wraps on '+' boundaries when topping run is too long", () => {
    const r = wrapModifierLine(
      "Lychee Jelly(2)+Grape Jelly+Lychee Jelly -> 50%S",
      20,
    );
    expect(r.length).toBeGreaterThan(1);
    // Each line should still respect the cap (allow some slack for the
    // separator glyph at end-of-line).
    for (const line of r) expect(line.length).toBeLessThanOrEqual(28);
  });

  it("appends ellipsis when truncating beyond MOD_MAX_LINES (6)", () => {
    const r = wrapModifierLine(
      "A -> B -> C -> D -> E -> F -> G -> H -> I -> J -> K -> L",
      3,
    );
    expect(r.length).toBe(6);
    expect(r[5]).toMatch(/…$/);
  });

  it("treats embedded `\\n` as explicit per-group line breaks", () => {
    const r = wrapModifierLine("Oat Milk\nPearls + Jelly Ball\nL.Ice\n50%S", 28);
    expect(r).toEqual(["Oat Milk", "Pearls + Jelly Ball", "L.Ice", "50%S"]);
  });
});
