import { describe, expect, it } from "vitest";
import { wavePath, waveSegmentCount } from "./wave";

const spec = { x0: 25, width: 70, top: 58, amplitude: 1.6, wavelength: 24, depth: 9 };

describe("wave path", () => {
  const d = wavePath(spec);

  it("starts one wavelength left of the covered area, on the surface line", () => {
    expect(d.startsWith("M1 58")).toBe(true);
  });

  it("is a closed ribbon that drops to the fill depth", () => {
    expect(d.endsWith("Z")).toBe(true);
    expect(d).toContain("V67");
    expect(d).toContain("H1");
  });

  it("draws two quadratic curves per wavelength, alternating crest and trough", () => {
    const curves = d.match(/Q[^QVHZ]+/g) ?? [];
    expect(curves.length).toBe(waveSegmentCount(spec));
    expect(curves.length).toBe(Math.ceil((70 + 48) / 12));
    // First control point rides above the line, second below.
    expect(curves[0]).toContain(`${58 - 1.6}`);
    expect(curves[1]).toContain(`${58 + 1.6}`);
  });

  it("covers past the right edge so a one-wavelength scroll never shows a gap", () => {
    // Every curve ends back on the surface line; the last one must end past
    // the covered area plus one wavelength.
    const ends = [...d.matchAll(/Q[\d.-]+ [\d.-]+ ([\d.-]+) [\d.-]+/g)].map((m) =>
      parseFloat(m[1]),
    );
    expect(ends.length).toBeGreaterThan(0);
    expect(Math.max(...ends)).toBeGreaterThanOrEqual(25 + 70 + 24);
  });

  it("never produces NaN and clamps a silly wavelength", () => {
    expect(wavePath({ ...spec, wavelength: 0 })).not.toMatch(/NaN/);
    expect(wavePath(spec)).not.toMatch(/NaN/);
  });

  it("is deterministic", () => {
    expect(wavePath(spec)).toBe(wavePath({ ...spec }));
  });
});
