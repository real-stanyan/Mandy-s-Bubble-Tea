// src/lib/doodle/binarize.ts
//
// 300dpi 1-bit thermal preprocessing pipeline used by AI-generated and
// photo-uploaded cup-label doodles. Three binarisation strategies, each
// optimised for a different content type:
//
//   * threshold — hard >=128 white / <128 black. Best for high-contrast
//     line-art (AI prompts with forced line-art suffix, hand-drawn
//     doodles). Crushes photos into black blobs.
//
//   * floyd-steinberg — diffuses quantisation error into neighbours
//     (coefficients 7/3/5/1 over 16). Renders continuous tone as a
//     fine dot pattern. Maximum detail; can look noisy at full 300dpi.
//
//   * atkinson — classic Mac-era diffusion (six neighbours, 1/8 each;
//     only 6/8 of the error propagates, the rest discarded). Higher
//     contrast than FS, lower dot density in midtones — cleaner,
//     more "halftone-magazine" look. Default for photo uploads.
//
// Photo paths additionally do TWO things that the line-art path skips:
//
//   1. Contrast curve `linear(1.45, -57)` (≈ +45% gain, -57 offset)
//      pushes shadows toward pure black and highlights toward pure
//      white, leaving less area in dither-zone midtones → less visual
//      noise.
//
//   2. Half-resolution dither + nearest-neighbour upscale. We binarise
//      at 296×296 (DOODLE_SIZE / 2) then nearest-neighbour scale to
//      592×592, so every dither dot becomes a clean 2×2 physical dot
//      on the ZD410. At one-dot-per-pixel the printer's thermal bleed
//      smears fine dither into mush; doubling the dot footprint gives
//      newspaper-halftone clarity at 300dpi.

import sharp from "sharp";

export const DOODLE_SIZE = 592;

export type BinarizeMode = "threshold" | "floyd-steinberg" | "atkinson";

export type BinarizeOptions = {
  mode: BinarizeMode;
  threshold?: number; // only used when mode === "threshold"; default 128
};

function floydSteinberg(gray: Buffer, w: number, h: number): Uint8Array {
  // Float32 so accumulated error doesn't clip / wrap before propagation.
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

function atkinson(gray: Buffer, w: number, h: number): Uint8Array {
  // Bill Atkinson's 1980s Macintosh dither: six neighbours, each gets
  // 1/8 of the quantisation error, dropping 2/8 entirely. Net result:
  // brighter midtones, more "open" white space, less dense than FS.
  // Pattern:   .  *  1  1
  //            1  1  1
  //                  1
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

export async function binarizeForThermal(
  rawImage: Buffer,
  opts: BinarizeOptions,
): Promise<Buffer> {
  // Line-art / hard-threshold path — full DOODLE_SIZE resolution, no
  // contrast curve, light sharpen to keep strokes crisp.
  if (opts.mode === "threshold") {
    const gray = await sharp(rawImage)
      .resize(DOODLE_SIZE, DOODLE_SIZE, { fit: "cover" })
      .sharpen({ sigma: 1 })
      .grayscale()
      .raw()
      .toBuffer();
    const t = opts.threshold ?? 128;
    const bin = Buffer.from(gray.map((v) => (v < t ? 0 : 255)));
    return sharp(bin, {
      raw: { width: DOODLE_SIZE, height: DOODLE_SIZE, channels: 1 },
    })
      .png()
      .toBuffer();
  }

  // Photo path: full-resolution dither (every output pixel is its own
  // dither cell) for maximum facial detail, with three pre-passes that
  // make the dither output legible at 300dpi 1-bit:
  //
  //   1. normalize() — stretches the input histogram to fill 0..255
  //      so the next linear pass has consistent range to work from.
  //
  //   2. linear(0.85, 25) — SHADOW LIFT. Compresses to [25..242] so
  //      dark regions land in Atkinson's dither zone (~25%-density
  //      black pattern) instead of clipping to solid black.
  //
  //   3. blur(sigma=0.4) — small Gaussian removes sensor-grain /
  //      skin-pore micro-noise that dithers into pure static. Real
  //      features (eyes, glasses, hair strands) are wider than this
  //      and survive untouched.
  //
  // Atkinson over FS keeps the midtone dot density around 30% instead
  // of FS's 50% — combined with the shadow lift this gives a cleaner
  // halftone-magazine look with readable shadow detail.
  const gray = await sharp(rawImage)
    .resize(DOODLE_SIZE, DOODLE_SIZE, { fit: "cover" })
    .normalize()
    .linear(0.85, 25)
    .blur(0.4)
    .grayscale()
    .raw()
    .toBuffer();

  const dithered =
    opts.mode === "atkinson"
      ? atkinson(gray, DOODLE_SIZE, DOODLE_SIZE)
      : floydSteinberg(gray, DOODLE_SIZE, DOODLE_SIZE);

  return sharp(Buffer.from(dithered), {
    raw: { width: DOODLE_SIZE, height: DOODLE_SIZE, channels: 1 },
  })
    .png()
    .toBuffer();
}
