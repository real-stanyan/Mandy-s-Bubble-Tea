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
      drinkName: "Caret^Tilde~Slash\\Drink",
      modifiersText: "",
      doodleSvg: POOL[0].svg,
    });
    // Raw ^ ~ \ would break ZPL parsing on the printer; verify replaced.
    expect(out.zpl).not.toContain("Caret^Tilde");
    expect(out.zpl).toContain("Caret-Tilde-Slash/Drink");
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
    const out = await renderCupLabel({
      stickerNumber: "OL000",
      cupIdxOf: { idx: 1, total: 1 },
      drinkName: "Test",
      modifiersText: "",
      doodleSvg: POOL[0].svg,
    });
    // No ^FB,..,L,0^FD<…modifier text…>^FS line should be emitted; the
    // bottom band stays blank rather than printing a placeholder.
    const fbCount = (out.zpl.match(/\^FB/g) ?? []).length;
    // Drink name uses one ^FB; modifier should NOT add a second.
    expect(fbCount).toBe(1);
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

  it("appends ellipsis when truncating beyond 4 lines", () => {
    const r = wrapModifierLine(
      "A -> B -> C -> D -> E -> F -> G -> H -> I -> J -> K -> L",
      3,
    );
    expect(r.length).toBe(4);
    expect(r[3]).toMatch(/…$/);
  });
});
