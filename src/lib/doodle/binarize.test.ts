// src/lib/doodle/binarize.test.ts
import { describe, it, expect, afterEach } from "vitest";
import sharp from "sharp";
import {
  binarizeForThermal,
  isDarkSource,
  needsShadowRecovery,
} from "./binarize";

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

// The failure class the mean-only rule missed: a correctly-exposed bright
// subject filling ~half the frame against a deep-shadow background. The mean
// lands well above DARK_MEAN_THRESHOLD, so routing on brightness alone sends
// it to v1 and the background prints as one black slab.
async function brightSubjectOnBlack(w = 200, h = 200): Promise<Buffer> {
  const buf = Buffer.alloc(w * h * 3, 20);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w / 2; x++) {
      const i = (y * w + x) * 3;
      buf[i] = buf[i + 1] = buf[i + 2] = 230;
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

describe("needsShadowRecovery", () => {
  it("flags a globally underexposed source, same as isDarkSource", async () => {
    expect(await needsShadowRecovery(await nightPhoto())).toBe(true);
  });

  it("flags a bright subject on a deep-shadow background that the mean alone misses", async () => {
    const src = await brightSubjectOnBlack();
    // Precondition: this is exactly the case the old rule let through.
    expect(await isDarkSource(src)).toBe(false);
    expect(await needsShadowRecovery(src)).toBe(true);
  });

  it("leaves an evenly-lit source alone", async () => {
    expect(await needsShadowRecovery(await solidGray(150))).toBe(false);
  });

  it("fails safe (false) on unreadable input", async () => {
    expect(await needsShadowRecovery(Buffer.from("not an image"))).toBe(false);
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

  it("a bright-subject-on-black source now prints with less black coverage than v1", async () => {
    delete process.env.BINARIZE_PIPELINE;
    const src = await brightSubjectOnBlack();
    const routedBlack = await blackRatio(
      await binarizeForThermal(src, { mode: "atkinson" }),
    );

    const { binarizeForThermalV1 } = await import("./binarize.v1");
    const v1Black = await blackRatio(
      await binarizeForThermalV1(src, { mode: "atkinson" }),
    );

    expect(routedBlack).toBeLessThan(v1Black);
  });
});
