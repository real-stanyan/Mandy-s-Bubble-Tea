// src/lib/doodle/binarize.v1.ts
//
// FROZEN SNAPSHOT — 2026-05-15 PM
//
// This is the production-validated v1 pipeline at the end of the
// async-AI + admin-gallery ship train. Verified live on real ZD410 +
// real iPhone orders (OL802, OL817, OL824, OL825). Kept verbatim so
// `binarize.ts` can roll back to this in one switch if v2+ experiments
// regress on real prints.
//
// Recipe documented in memory `feedback_doubao_thermal_photo_pipeline.md`:
//   normalize + linear(0.85, 25) + blur(0.4) + Atkinson dither
//
// DO NOT modify this file. To iterate, edit `binarize.ts` (which
// re-exports `binarizeForThermalV1` from here as the rollback path).

import sharp from "sharp";

export const DOODLE_SIZE_V1 = 592;

export type BinarizeModeV1 = "threshold" | "floyd-steinberg" | "atkinson";

export type BinarizeOptionsV1 = {
  mode: BinarizeModeV1;
  threshold?: number;
};

function floydSteinbergV1(gray: Buffer, w: number, h: number): Uint8Array {
  const buf = new Float32Array(gray);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = buf[i];
      const next = old < 128 ? 0 : 255;
      buf[i] = next;
      const err = old - next;
      if (x + 1 < w) buf[i + 1] += (err * 7) / 16;
      if (y + 1 < h) {
        if (x > 0) buf[i + w - 1] += (err * 3) / 16;
        buf[i + w] += (err * 5) / 16;
        if (x + 1 < w) buf[i + w + 1] += err / 16;
      }
    }
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] < 128 ? 0 : 255;
  return out;
}

function atkinsonV1(gray: Buffer, w: number, h: number): Uint8Array {
  const buf = new Float32Array(gray);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = buf[i];
      const next = old < 128 ? 0 : 255;
      buf[i] = next;
      const err = (old - next) / 8;
      if (x + 1 < w) buf[i + 1] += err;
      if (x + 2 < w) buf[i + 2] += err;
      if (y + 1 < h) {
        if (x > 0) buf[i + w - 1] += err;
        buf[i + w] += err;
        if (x + 1 < w) buf[i + w + 1] += err;
      }
      if (y + 2 < h) buf[i + 2 * w] += err;
    }
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] < 128 ? 0 : 255;
  return out;
}

export async function binarizeForThermalV1(
  rawImage: Buffer,
  opts: BinarizeOptionsV1,
): Promise<Buffer> {
  if (opts.mode === "threshold") {
    const gray = await sharp(rawImage)
      .resize(DOODLE_SIZE_V1, DOODLE_SIZE_V1, { fit: "cover" })
      .sharpen({ sigma: 1 })
      .grayscale()
      .raw()
      .toBuffer();
    const t = opts.threshold ?? 128;
    const bin = Buffer.from(gray.map((v) => (v < t ? 0 : 255)));
    return sharp(bin, {
      raw: { width: DOODLE_SIZE_V1, height: DOODLE_SIZE_V1, channels: 1 },
    })
      .png()
      .toBuffer();
  }

  const gray = await sharp(rawImage)
    .resize(DOODLE_SIZE_V1, DOODLE_SIZE_V1, { fit: "cover" })
    .normalize()
    .linear(0.85, 25)
    .blur(0.4)
    .grayscale()
    .raw()
    .toBuffer();

  const dithered =
    opts.mode === "atkinson"
      ? atkinsonV1(gray, DOODLE_SIZE_V1, DOODLE_SIZE_V1)
      : floydSteinbergV1(gray, DOODLE_SIZE_V1, DOODLE_SIZE_V1);

  return sharp(Buffer.from(dithered), {
    raw: { width: DOODLE_SIZE_V1, height: DOODLE_SIZE_V1, channels: 1 },
  })
    .png()
    .toBuffer();
}
