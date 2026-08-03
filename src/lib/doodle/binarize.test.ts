// src/lib/doodle/binarize.test.ts
import { describe, it, expect, afterEach } from "vitest";
import sharp from "sharp";
import { binarizeForThermal, isDarkSource } from "./binarize";

async function solidGray(level: number, w = 200, h = 200): Promise<Buffer> {
  const buf = Buffer.alloc(w * h * 3, level);
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

// Mimics a night photo: a big dark background spike plus a small bright
// highlight (phone flash / streetlight), so a naive min/max stretch has
// little room to lift the shadow-heavy midtones.
async function nightPhoto(w = 200, h = 200): Promise<Buffer> {
  const buf = Buffer.alloc(w * h * 3, 15);
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 20; x++) {
      const i = (y * w + x) * 3;
      buf[i] = buf[i + 1] = buf[i + 2] = 250;
    }
  }
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

async function blackRatio(png: Buffer): Promise<number> {
  const { data } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  let black = 0;
  for (const px of data) if (px === 0) black++;
  return black / data.length;
}

const ORIGINAL_PIPELINE = process.env.BINARIZE_PIPELINE;
afterEach(() => {
  if (ORIGINAL_PIPELINE === undefined) delete process.env.BINARIZE_PIPELINE;
  else process.env.BINARIZE_PIPELINE = ORIGINAL_PIPELINE;
});

describe("isDarkSource", () => {
  it("flags a dark/underexposed source", async () => {
    expect(await isDarkSource(await nightPhoto())).toBe(true);
    expect(await isDarkSource(await solidGray(20))).toBe(true);
  });

  it("does not flag a normally-lit source", async () => {
    expect(await isDarkSource(await solidGray(150))).toBe(false);
  });

  it("fails safe (false) on unreadable input", async () => {
    expect(await isDarkSource(Buffer.from("not an image"))).toBe(false);
  });
});

describe("binarizeForThermal auto-dark routing", () => {
  it("keeps a normally-lit photo on the default (v1) path", async () => {
    delete process.env.BINARIZE_PIPELINE;
    const out = await binarizeForThermal(await solidGray(150), { mode: "atkinson" });
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(592);
    expect(meta.height).toBe(592);
  });

  it("a night-photo-shaped source prints with meaningfully less black coverage than a naive global stretch", async () => {
    delete process.env.BINARIZE_PIPELINE;
    const src = await nightPhoto();
    const routed = await binarizeForThermal(src, { mode: "atkinson" });
    const routedBlack = await blackRatio(routed);

    // Force the pre-fix behaviour for comparison: v1 unconditionally.
    const { binarizeForThermalV1 } = await import("./binarize.v1");
    const v1Forced = await binarizeForThermalV1(src, { mode: "atkinson" });
    const v1Black = await blackRatio(v1Forced);

    expect(routedBlack).toBeLessThan(v1Black);
  });
});
