import { describe, it, expect } from "vitest";
import { renderCupLabelToBitmap, LABEL_WIDTH_DOTS, LABEL_HEIGHT_DOTS } from "./render-tsp100";
import { POOL } from "../doodle/pool";

describe("TSP100 sandwich label compositor", () => {
  it("produces a bitmap of exact 50x80mm @ 203 DPI", async () => {
    const bm = await renderCupLabelToBitmap({
      stickerNumber: "OL856",
      cupIdxOf: { idx: 1, total: 2 },
      drinkName: "Pearl Milk Tea",
      modifiersText: "L · Pearl×2 · 50%S · Warm",
      doodleSvg: POOL[0].svg,
    });
    const widthBytes = LABEL_WIDTH_DOTS / 8;
    expect(bm.length).toBe(widthBytes * LABEL_HEIGHT_DOTS);
    expect(LABEL_WIDTH_DOTS).toBe(400);
    expect(LABEL_HEIGHT_DOTS).toBe(640);
  });

  it("returns 1-bit packed bitmap (every byte is 0..255 of 8 packed pixels)", async () => {
    const bm = await renderCupLabelToBitmap({
      stickerNumber: "OL000",
      cupIdxOf: { idx: 1, total: 1 },
      drinkName: "Test",
      modifiersText: "M",
      doodleSvg: POOL[0].svg,
    });
    const allZero = bm.every(b => b === 0);
    const allFf = bm.every(b => b === 0xff);
    expect(allZero).toBe(false);
    expect(allFf).toBe(false);
  });
});
