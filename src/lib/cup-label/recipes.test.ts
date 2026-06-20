// src/lib/cup-label/recipes.test.ts
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { RECIPES, getRecipe, colorThumb } from "./recipes";

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
