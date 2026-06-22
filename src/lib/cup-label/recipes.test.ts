// src/lib/cup-label/recipes.test.ts
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { RECIPES, getRecipe, colorThumb, clampParams, runParametric, PRESET_PARAMS, PARAM_BOUNDS } from "./recipes";
import { binarizeForThermal } from "@/lib/doodle/binarize";

// A small synthetic source: 200x200, left half black, right half saturated red.
async function sampleSource(): Promise<Buffer> {
  const w = 200, h = 200;
  const buf = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    if (x < w / 2) { buf[i] = 0; buf[i + 1] = 0; buf[i + 2] = 0; }
    else { buf[i] = 220; buf[i + 1] = 20; buf[i + 2] = 20; }
  }
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

describe("RECIPES", () => {
  it("exposes 5 recipes in stable order", () => {
    expect(RECIPES.map((r) => r.id)).toEqual(["default", "high-contrast", "bolder", "ink-line", "drop-bg"]);
  });

  it("every recipe returns a 592x592 single-channel PNG", async () => {
    const src = await sampleSource();
    for (const r of RECIPES) {
      const out = await r.run(src);
      const meta = await sharp(out).metadata();
      expect(meta.width, r.id).toBe(592);
      expect(meta.height, r.id).toBe(592);
    }
  });

  it("recipes produce genuinely different output (not all identical)", async () => {
    const src = await sampleSource();
    const def = (await getRecipe("default")!.run(src)).toString("base64");
    const drop = (await getRecipe("drop-bg")!.run(src)).toString("base64");
    expect(def).not.toBe(drop);
  });

  it("getRecipe returns null for unknown id", () => {
    expect(getRecipe("nope")).toBeNull();
  });

  it("colorThumb fits within 480px", async () => {
    const src = await sampleSource();
    const meta = await sharp(await colorThumb(src)).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(480);
  });
});

describe("clampParams", () => {
  it("fills defaults for missing/non-numeric fields", () => {
    expect(clampParams(undefined)).toEqual({
      contrast: PARAM_BOUNDS.contrast.default,
      brightness: PARAM_BOUNDS.brightness.default,
      blur: PARAM_BOUNDS.blur.default,
      threshold: PARAM_BOUNDS.threshold.default,
      mode: "atkinson",
      scale: PARAM_BOUNDS.scale.default,
    });
    const bad = clampParams({ contrast: NaN, brightness: "x" as unknown as number, threshold: undefined });
    expect(bad.contrast).toBe(PARAM_BOUNDS.contrast.default);
    expect(bad.brightness).toBe(PARAM_BOUNDS.brightness.default);
  });

  it("clamps out-of-range values to bounds and rounds threshold", () => {
    const p = clampParams({ contrast: 99, brightness: -999, blur: 50, threshold: 300.7, mode: "threshold" });
    expect(p.contrast).toBe(PARAM_BOUNDS.contrast.max);
    expect(p.brightness).toBe(PARAM_BOUNDS.brightness.min);
    expect(p.blur).toBe(PARAM_BOUNDS.blur.max);
    expect(p.threshold).toBe(255);
    expect(p.mode).toBe("threshold");
  });

  it("only accepts 'threshold' as the alternate mode", () => {
    expect(clampParams({ mode: "floyd" as unknown as "threshold" }).mode).toBe("atkinson");
    expect(clampParams({ mode: "threshold" }).mode).toBe("threshold");
  });
});

describe("runParametric", () => {
  it("returns a 592x592 PNG for default params", async () => {
    const src = await sampleSource();
    const meta = await sharp(await runParametric(src, PRESET_PARAMS.default)).metadata();
    expect(meta.width).toBe(592);
    expect(meta.height).toBe(592);
  });

  it("darker brightness yields more black ink than lighter", async () => {
    // Representative source: a full-range horizontal gradient (0→255), like
    // real black-line-on-white art. A narrow-range image would be neutralised
    // by binarize's internal normalize() and mask the brightness effect.
    const w = 240, h = 240;
    const g = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = Math.round((x / (w - 1)) * 255);
      const i = (y * w + x) * 3;
      g[i] = v; g[i + 1] = v; g[i + 2] = v;
    }
    const src = await sharp(g, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
    const blackCount = async (params: Parameters<typeof runParametric>[1]) => {
      const out = await runParametric(src, params);
      const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
      let n = 0;
      for (let i = 0; i < data.length; i += info.channels) if (data[i] < 128) n++;
      return n;
    };
    const darker = await blackCount({ ...PRESET_PARAMS.default, brightness: -60 });
    const lighter = await blackCount({ ...PRESET_PARAMS.default, brightness: 30 });
    expect(darker).toBeGreaterThan(lighter);
  });

  it("threshold mode differs from atkinson mode", async () => {
    const src = await sampleSource();
    const atk = (await runParametric(src, { ...PRESET_PARAMS.default, mode: "atkinson" })).toString("base64");
    const thr = (await runParametric(src, { ...PRESET_PARAMS.default, mode: "threshold", threshold: 128 })).toString("base64");
    expect(atk).not.toBe(thr);
  });

  it("tolerates garbage params (clamps, never throws)", async () => {
    const src = await sampleSource();
    const out = await runParametric(src, { contrast: -5, brightness: 999, blur: -1, threshold: 9999 } as never);
    expect((await sharp(out).metadata()).width).toBe(592);
  });

  it("scale=1 is a no-op (identical to the default recipe)", async () => {
    const src = await sampleSource();
    const a = await runParametric(src, { ...PRESET_PARAMS.default, scale: 1 });
    const b = await binarizeForThermal(src, { mode: "atkinson" });
    expect(a.equals(b)).toBe(true);
  });

  it("shrinking (scale<1) adds white margin → more white than scale=1", async () => {
    // A mostly-black full-frame source: shrinking it leaves a white border.
    const w = 300, h = 300, buf = Buffer.alloc(w * h * 3, 0); // all black
    const src = await sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
    const whiteCount = async (scale: number) => {
      const out = await runParametric(src, { ...PRESET_PARAMS.default, scale });
      const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
      let n = 0;
      for (let i = 0; i < data.length; i += info.channels) if (data[i] >= 128) n++;
      return n;
    };
    expect(await whiteCount(0.5)).toBeGreaterThan(await whiteCount(1));
  });

  it("enlarging (scale>1) centre-crops to 592×592 without throwing (regression: composite size error)", async () => {
    const src = await sampleSource();
    const out = await runParametric(src, { ...PRESET_PARAMS.default, scale: 2 });
    const m = await sharp(out).metadata();
    expect(m.width).toBe(592);
    expect(m.height).toBe(592);
  });
});

describe("PRESET_PARAMS", () => {
  it("has a param seed for every recipe id", () => {
    for (const r of RECIPES) expect(PRESET_PARAMS[r.id], r.id).toBeDefined();
  });
});
