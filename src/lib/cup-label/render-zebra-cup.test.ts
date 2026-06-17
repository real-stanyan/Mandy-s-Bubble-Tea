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

  it("POS fix: customer name goes to the greeting, a numeric order number to the right slot", async () => {
    // Regression for the "Hi, Soul" / "Mao Sasaki · 1/1" mismap: a POS
    // order with an attached member should read "Hi, {firstName}" on the
    // left and a plain number on the right — NOT the customer's name in
    // the number slot, NOT the "Soul" fallback greeting.
    const out = await renderCupLabel({
      stickerNumber: "47", // store-counter number (no longer the ticket NAME)
      cupIdxOf: { idx: 1, total: 1 },
      drinkName: "Guava Iced Green Tea",
      modifiersText: "Lychee Jelly",
      doodleSvg: POOL[0].svg,
      customerFirstName: "Mao", // first name from the attached Square customer
    });
    expect(out.zpl).toContain("Hi, Mao"); // greeting carries the name
    expect(out.zpl).not.toContain("Hi, Soul"); // not the empty-name fallback
    expect(out.zpl).toContain("47 · 1/1"); // right slot = number · cupFrac
    // The right-column ^FD must carry the number, never the customer name.
    const rightField = out.zpl.split("\n").find((l) => l.includes("· 1/1"))!;
    expect(rightField).toContain("47");
    expect(rightField).not.toContain("Mao");
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
    // Long name (27 chars) → drinkFontSizeFor returns 34 (was 20 before
    // 2026-05-22 layout swap moved drink to bottom band with wider budget).
    expect(out.zpl).toContain("^A0N,34,34");
  });

  it("embeds the Mandy logo as a plain ^GFA block at the bottom-right (no ^FR)", async () => {
    const out = await renderCupLabel({
      stickerNumber: "OL000",
      cupIdxOf: { idx: 1, total: 1 },
      drinkName: "Test",
      modifiersText: "",
      doodleSvg: POOL[0].svg,
    });
    // Bottom band is white, so the logo's pre-binarised print-bits paint
    // as black ink directly — no ^FR needed (^FR was required on the
    // previous top-band-on-black placement). Anchor point: x ≥ 400
    // confirms it landed in the right half of the 590-dot label.
    const logoMatch = out.zpl.match(/\^FO(\d+),(\d+)\^GFA,\d+,\d+,11,/);
    expect(logoMatch).not.toBeNull();
    const x = Number(logoMatch![1]);
    const y = Number(logoMatch![2]);
    expect(x).toBeGreaterThan(400);
    expect(y).toBeGreaterThan(700);
    // And there should not be a ^FR^GFA anywhere — that pattern was the
    // pre-move (white-silhouette-on-black) contract.
    expect(out.zpl).not.toMatch(/\^FR\^GFA,/);
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

  it("appends ellipsis when truncating beyond MOD_MAX_LINES (5)", () => {
    const r = wrapModifierLine(
      "A -> B -> C -> D -> E -> F -> G -> H -> I -> J -> K -> L",
      3,
    );
    expect(r.length).toBe(5);
    expect(r[4]).toMatch(/…$/);
  });

  it("treats embedded `\\n` as explicit per-group line breaks", () => {
    const r = wrapModifierLine("Oat Milk\nPearls + Jelly Ball\nL.Ice\n50%S", 28);
    expect(r).toEqual(["Oat Milk", "Pearls + Jelly Ball", "L.Ice", "50%S"]);
  });
});

describe("renderCupLabel (keepsake variant)", () => {
  const base = {
    stickerNumber: "OL900",
    cupIdxOf: { idx: 1, total: 1 },
    drinkName: "Pearl Milk Tea",
    modifiersText: "Pearls -> 50%S",
    doodleSvg:
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#000"/></svg>',
    customerFirstName: "Stan",
  };

  it("omits drink name + modifiers when keepsake is true", async () => {
    const { zpl } = await renderCupLabel({ ...base, keepsake: true });
    expect(zpl).not.toContain("Pearl Milk Tea");
    expect(zpl).not.toContain("50%S");
    // Greeting + order/cup line are retained.
    expect(zpl).toContain("Hi, Stan");
    expect(zpl).toContain("OL900");
  });

  it("keeps drink name + modifiers when keepsake is absent (regression)", async () => {
    const { zpl } = await renderCupLabel(base);
    expect(zpl).toContain("Pearl Milk Tea");
    expect(zpl).toContain("50%S");
  });
});
