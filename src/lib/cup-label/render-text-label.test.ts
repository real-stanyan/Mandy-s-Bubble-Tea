import { describe, it, expect } from "vitest";
import { renderTextCupLabel, TEXT_LABEL_WIDTH_DOTS, TEXT_LABEL_HEIGHT_DOTS } from "./render-text-label";
import { renderCupLabel } from "./render-zebra-cup";
import { POOL } from "../doodle/pool";

const base = {
  stickerNumber: "OL999",
  cupIdxOf: { idx: 1, total: 2 },
  drinkName: "Pearl Milk Tea",
  modifiersText: "Pearls(2)+Pudding -> L.Ice -> 50%S",
  doodleSvg: "",
};

describe("40x30 text-only cup label", () => {
  it("emits valid ZPL II at 40x30mm dimensions with no raster art", async () => {
    const out = await renderTextCupLabel(base);
    expect(out.zpl.startsWith("^XA")).toBe(true);
    expect(out.zpl.endsWith("^XZ")).toBe(true);
    expect(out.zpl).toContain(`^PW${TEXT_LABEL_WIDTH_DOTS}`);
    expect(out.zpl).toContain(`^LL${TEXT_LABEL_HEIGHT_DOTS}`);
    // Text-only paper: no graphic fields, ever (no doodle, no logo).
    expect(out.zpl).not.toContain("^GFA");
  });

  it("40mm/30mm at 300dpi round to 472/354 dots", () => {
    expect(TEXT_LABEL_WIDTH_DOTS).toBe(472);
    expect(TEXT_LABEL_HEIGHT_DOTS).toBe(354);
    expect(TEXT_LABEL_WIDTH_DOTS % 8).toBe(0);
  });

  it("prints the ticket number as the hero at 80-dot font", async () => {
    const out = await renderTextCupLabel(base);
    expect(out.zpl).toContain("OL999");
    const stickerField = out.zpl.split("\n").find((l) => l.includes("OL999"));
    expect(stickerField).toContain("^A0N,80,80");
    expect(stickerField).toContain("^FR"); // white-on-black top band
  });

  it("scales the ticket font down for long numbers instead of clipping", async () => {
    const out = await renderTextCupLabel({ ...base, stickerNumber: "OL12345" });
    const stickerField = out.zpl.split("\n").find((l) => l.includes("OL12345"));
    expect(stickerField).toContain("^A0N,60,60");
  });

  it("prints order details: drink name, cup fraction, modifiers", async () => {
    const out = await renderTextCupLabel(base);
    expect(out.zpl).toContain("Pearl Milk Tea");
    expect(out.zpl).toContain("1/2");
    expect(out.zpl).toContain("Pearls(2)+Pudding");
    expect(out.zpl).toContain("50%S");
  });

  it("ignores doodle raster + fortune inputs (nothing raster fits on 30mm)", async () => {
    const out = await renderTextCupLabel({
      ...base,
      doodleSvg: POOL[0].svg,
      doodlePngBuffer: Buffer.from("89504e47", "hex"),
      fortuneText: "A fortune that must not print",
    });
    expect(out.zpl).not.toContain("^GFA");
    expect(out.zpl).not.toContain("A fortune that must not print");
  });

  it("stacks the pickup stamp for scheduled orders", async () => {
    const out = await renderTextCupLabel({
      ...base,
      pickupAt: "2026-08-26T07:45:00.000Z", // 5:45pm Brisbane
    });
    expect(out.zpl).toContain("PU 5:45pm");
  });

  it("omits the pickup line for ASAP orders and never prints NaN", async () => {
    const out = await renderTextCupLabel({ ...base, pickupAt: "not-a-date" });
    expect(out.zpl).not.toContain("PU ");
    expect(out.zpl).not.toContain("NaN");
  });

  it("keepsake copies keep the ticket number but omit drink + modifiers", async () => {
    const out = await renderTextCupLabel({ ...base, keepsake: true });
    expect(out.zpl).toContain("OL999");
    expect(out.zpl).not.toContain("Pearl Milk Tea");
    expect(out.zpl).not.toContain("50%S");
  });

  it("caps modifiers at 3 lines with an ellipsis", async () => {
    const out = await renderTextCupLabel({
      ...base,
      modifiersText:
        "Oat Milk\nPearls(2)+Grass Jelly+Pudding+Coconut Jelly+Aloe Vera\nLess Ice\n50% Sugar\nExtra Shot",
    });
    const modField = out.zpl.split("\n").find((l) => l.includes("\\&"));
    expect(modField).toBeDefined();
    const lines = modField!.split("\\&");
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(out.zpl).toContain("…");
  });

  it("resets the printer's stored label-top offset with ^LT0", async () => {
    // The ZD410 keeps ^LT in NVRAM across rolls. A stale offset from the
    // 50x80 photo roll shifts the whole 30mm print down and clips the
    // bottom — seen live 2026-08-26. Every format must pin it to 0.
    const out = await renderTextCupLabel(base);
    expect(out.zpl).toContain("^LT0");
  });

  it("starts modifiers directly under a one-line drink name (no dead band)", async () => {
    // "Pearl Milk Tea" = 14 chars → 52-dot font, one line. Modifiers
    // must not sit at a fixed Y that assumes a two-line name.
    const out = await renderTextCupLabel(base);
    const modField = out.zpl.split("\n").find((l) => l.includes("Pearls(2)"))!;
    const y = Number(/\^FO\d+,(\d+)/.exec(modField)![1]);
    expect(y).toBe(120 + 52 + 16);
  });

  it("keeps worst-case content above a real bottom margin", async () => {
    // Two-line drink name + 3 capped modifier lines must still end at
    // least 24 dots (~2mm) above the 354-dot label bottom, so ordinary
    // tear-off / calibration drift can't clip the last line.
    const out = await renderTextCupLabel({
      ...base,
      drinkName: "Brown Sugar Oreo Brulee ML", // 26 chars → 36-dot font, 2 lines
      modifiersText:
        "Oat Milk\nPearls(2)+Grass Jelly+Pudding+Coconut Jelly\nLess Ice\n50% Sugar",
    });
    const modField = out.zpl.split("\n").find((l) => l.includes("\\&"))!;
    const y = Number(/\^FO\d+,(\d+)/.exec(modField)![1]);
    const bottom = y + 3 * (34 + 2);
    expect(bottom).toBeLessThanOrEqual(TEXT_LABEL_HEIGHT_DOTS - 24);
  });

  it("escapes ZPL control characters in user-influenced fields", async () => {
    const out = await renderTextCupLabel({ ...base, drinkName: "A^B~C\\Drink" });
    expect(out.zpl).not.toContain("A^B~C");
    expect(out.zpl).toContain("A-B-C/Drink");
  });

  it("renders a real preview PNG", async () => {
    const out = await renderTextCupLabel(base);
    expect(out.previewPng.length).toBeGreaterThan(500);
    expect(out.previewPng[0]).toBe(0x89);
    expect(out.previewPng[1]).toBe(0x50);
  });

  it("renderCupLabel dispatches to the text layout while 40x30 paper mode is active", async () => {
    const out = await renderCupLabel({ ...base, doodleSvg: POOL[0].svg });
    expect(out.zpl).toContain(`^PW${TEXT_LABEL_WIDTH_DOTS}`);
    expect(out.zpl).not.toContain("^GFA");
  });
});
