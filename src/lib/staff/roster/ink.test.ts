import { describe, it, expect } from "vitest";
import { INK, PAPER, readableInk, relativeLuminance } from "./ink";
import { STAFF } from "./model";

describe("readableInk", () => {
  it("puts dark text on the light end of the palette", () => {
    expect(readableInk("#F5E93C")).toBe(INK); // yellow
    expect(readableInk("#5BE1F0")).toBe(INK); // cyan
    expect(readableInk("#F5A03C")).toBe(INK); // orange
  });

  it("puts light text on the dark end", () => {
    expect(readableInk("#000000")).toBe(PAPER);
    expect(readableInk("#2A1E14")).toBe(PAPER); // the brand ink
  });

  it("accepts shorthand hex", () => {
    expect(readableInk("#fff")).toBe(INK);
    expect(relativeLuminance("#fff")).toBeCloseTo(relativeLuminance("#ffffff"), 5);
  });

  it("clears 4.5:1 for every colour in the staff palette", () => {
    // The names sit on these swatches at 14px, so AA normal text is the bar.
    for (const s of STAFF) {
      const bg = relativeLuminance(s.color);
      const fg = relativeLuminance(readableInk(s.color));
      const [hi, lo] = bg > fg ? [bg, fg] : [fg, bg];
      const ratio = (hi + 0.05) / (lo + 0.05);
      expect(ratio, `${s.name} on ${s.color}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
