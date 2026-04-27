import { describe, it, expect } from "vitest";
import { renderSvgToPng } from "./render-svg";
import { POOL } from "./pool";

describe("renderSvgToPng", () => {
  it("renders pool svg to PNG buffer at requested size", async () => {
    const buf = await renderSvgToPng(POOL[0].svg, { widthPx: 360, heightPx: 360 });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(100);
    // PNG magic bytes
    expect(buf.slice(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });

  it("renders user svg paths JSON to PNG", async () => {
    const paths = [
      { d: "M10,10 L50,50 L90,10", stroke: "#000", width: 4 },
    ];
    const buf = await renderSvgToPng(pathsToSvg(paths, 360), { widthPx: 360, heightPx: 360 });
    expect(buf.slice(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });
});

function pathsToSvg(paths: { d: string; stroke: string; width: number }[], size: number) {
  const inner = paths.map(p => `<path d="${p.d}" stroke="${p.stroke}" stroke-width="${p.width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">${inner}</svg>`;
}
