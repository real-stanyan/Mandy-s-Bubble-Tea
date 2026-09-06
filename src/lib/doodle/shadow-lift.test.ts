// src/lib/doodle/shadow-lift.test.ts
import { describe, it, expect } from "vitest";
import {
  SHADOW_LIFT,
  applyRegionShadowLift,
  buildShadowLiftLuts,
  flatStdThreshold,
  shadowRegionWeight,
} from "./shadow-lift";

const W = 200;
const H = 200;
const identity = (v: number) => v;
const v1Tone = (v: number) => 0.85 * v + 25;

function canvas(fill: number): Uint8Array {
  return new Uint8Array(W * H).fill(fill);
}

// A large dark block whose tone ramps left→right — the "black dress with
// folds" shape: deep shadow that still holds structure worth printing.
function shadedBlock(g: Uint8Array, x0 = 60, y0 = 60, size = 80, from = 8, to = 56): void {
  for (let y = y0; y < y0 + size; y++) {
    for (let x = x0; x < x0 + size; x++) {
      g[y * W + x] = Math.round(from + ((x - x0) / (size - 1)) * (to - from));
    }
  }
}

function flatBlock(g: Uint8Array, level: number, x0 = 60, y0 = 60, size = 80): void {
  for (let y = y0; y < y0 + size; y++) for (let x = x0; x < x0 + size; x++) g[y * W + x] = level;
}

// 3-dot lines: thinner than the opening radius, so they must never qualify.
function thinGrid(g: Uint8Array, level = 0, pitch = 20, thick = 3): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x % pitch < thick || y % pitch < thick) g[y * W + x] = level;
    }
  }
}

describe("buildShadowLiftLuts", () => {
  it("lifts every tone below the knee, leaves the knee and above bit-identical", () => {
    const { base, lifted } = buildShadowLiftLuts(v1Tone);
    for (let v = 0; v < SHADOW_LIFT.KNEE; v++) expect(lifted[v]).toBeGreaterThan(base[v]);
    for (let v = SHADOW_LIFT.KNEE; v < 256; v++) expect(lifted[v]).toBe(base[v]);
  });

  it("starts at the ink-limit floor and stays monotonic", () => {
    const { lifted } = buildShadowLiftLuts(identity);
    expect(lifted[0]).toBe(SHADOW_LIFT.FLOOR);
    for (let v = 1; v < 256; v++) expect(lifted[v]).toBeGreaterThanOrEqual(lifted[v - 1]);
  });
});

describe("flatStdThreshold", () => {
  it("asks graphic-looking sources for more shading evidence than photos", () => {
    expect(flatStdThreshold(0.9)).toBe(SHADOW_LIFT.FLAT_STD_PHOTO);
    expect(flatStdThreshold(0.2)).toBe(SHADOW_LIFT.FLAT_STD_GRAPHIC);
    expect(flatStdThreshold(0.2)).toBeGreaterThan(flatStdThreshold(0.9));
  });
});

describe("shadowRegionWeight", () => {
  it("lifts a large shaded dark region and reports its footprint", () => {
    const g = canvas(200);
    shadedBlock(g);
    const { lifted, weight, stats } = shadowRegionWeight(g, W, H);
    expect(lifted).toBe(true);
    expect(stats.maskFraction).toBeGreaterThan(0.12); // 80×80 of 200×200 = 16%
    expect(stats.textureP90).toBeGreaterThanOrEqual(SHADOW_LIFT.FLAT_STD_PHOTO);
    // Full weight in the middle of the block, none far outside it.
    expect(weight[100 * W + 100]).toBeGreaterThan(0.95);
    expect(weight[10 * W + 10]).toBe(0);
  });

  it("does not lift a flat fill — intentional ink stays solid", () => {
    const g = canvas(200);
    flatBlock(g, 10);
    const { lifted, stats } = shadowRegionWeight(g, W, H);
    expect(stats.maskFraction).toBeGreaterThan(0.12); // the region IS there...
    expect(lifted).toBe(false); // ...but it has nothing to reveal
  });

  it("ignores thin dark strokes entirely", () => {
    const g = canvas(200);
    thinGrid(g);
    const { lifted, stats } = shadowRegionWeight(g, W, H);
    expect(stats.maskFraction).toBe(0);
    expect(lifted).toBe(false);
  });

  it("a graphic-looking source needs more shading than a photo to qualify", () => {
    // Mostly white, one dark block with only gentle shading (a 10→38 ramp
    // over 80 dots ≈ std 3.4 in the 33×33 window): enough for a photo, not
    // for a poster/stamp.
    const g = canvas(250);
    shadedBlock(g, 60, 60, 80, 10, 38);
    const graphic = shadowRegionWeight(g, W, H);
    expect(graphic.stats.midtoneFraction).toBeLessThan(SHADOW_LIFT.PHOTO_MIDTONE_FRACTION);
    expect(graphic.stats.textureP90).toBeGreaterThanOrEqual(SHADOW_LIFT.FLAT_STD_PHOTO);
    expect(graphic.stats.textureP90).toBeLessThan(SHADOW_LIFT.FLAT_STD_GRAPHIC);
    expect(graphic.lifted).toBe(false);

    // Same block in a midtone-rich (photographic) surround → lifted.
    const p = canvas(150);
    shadedBlock(p, 60, 60, 80, 10, 38);
    const photo = shadowRegionWeight(p, W, H);
    expect(photo.stats.midtoneFraction).toBeGreaterThanOrEqual(SHADOW_LIFT.PHOTO_MIDTONE_FRACTION);
    expect(photo.lifted).toBe(true);
  });
});

describe("applyRegionShadowLift", () => {
  it("reproduces the base tone everywhere when nothing qualifies", () => {
    const g = canvas(200);
    flatBlock(g, 10);
    const { out, lifted } = applyRegionShadowLift(g, W, H, v1Tone);
    expect(lifted).toBe(false);
    const { base } = buildShadowLiftLuts(v1Tone);
    for (let i = 0; i < out.length; i += 97) expect(out[i]).toBe(base[g[i]]);
  });

  it("raises a shaded region to the ink limit, keeps its tonal order, and leaves the surround alone", () => {
    const g = canvas(200);
    shadedBlock(g);
    const { out, lifted } = applyRegionShadowLift(g, W, H, identity);
    expect(lifted).toBe(true);
    const row = 100 * W;
    // Darkest edge of the ramp sits at (or just above) the floor...
    expect(out[row + 70]).toBeGreaterThanOrEqual(SHADOW_LIFT.FLOOR);
    // ...the ramp is still a ramp (lighter source → lighter output)...
    expect(out[row + 130]).toBeGreaterThan(out[row + 70]);
    // ...and it never reaches the knee, so it still reads as dark.
    expect(out[row + 130]).toBeLessThan(SHADOW_LIFT.KNEE);
    // Surround (200, above the knee) is untouched.
    expect(out[10 * W + 10]).toBe(200);
    expect(out[190 * W + 190]).toBe(200);
  });

  it("does not move tones above the knee even inside a lifted region", () => {
    const g = canvas(200);
    shadedBlock(g);
    // A bright highlight in the middle of the dark block (a button, a logo).
    for (let y = 95; y < 105; y++) for (let x = 95; x < 105; x++) g[y * W + x] = 160;
    const { out, lifted } = applyRegionShadowLift(g, W, H, identity);
    expect(lifted).toBe(true);
    expect(out[100 * W + 100]).toBe(160);
  });
});
