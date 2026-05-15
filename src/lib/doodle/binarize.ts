// src/lib/doodle/binarize.ts
//
// 300dpi 1-bit thermal preprocessing pipeline. Versioned:
//
//   * v1 — production default. Snapshot in `./binarize.v1.ts`. Recipe:
//     normalize + linear(0.85, 25) + blur(0.4) + Atkinson LTR.
//     Validated live on ZD410 (OL802/OL817/OL824/OL825) and on three
//     test photos (Doubao North Face / 吃面妹子 / 戴眼镜哥 / 模糊吃饭照).
//     Stan eyeballed v1 vs v2/v2.1 on real thermal paper and picked v1
//     as "most natural" — v2's CLAHE+unsharp gains detail but reads
//     too harsh / crispy on thermal stock.
//
//   * v2 — opt-in experiment via `BINARIZE_PIPELINE=v2`. Aimed at the
//     v1 failure modes on faces and busy photo subjects at 300dpi:
//
//       1. CLAHE (tile = 48px, slope clip = 2) replaces v1's global
//          `linear(0.85, 25)` shadow lift. CLAHE equalises each tile
//          independently and clips the histogram slope so face skin /
//          hair / background each get their own contrast budget instead
//          of one global curve compressing everything. Initial v2 ran
//          tile=32 slope=3 — too aggressive on thermal paper, surfaced
//          micro-noise that looked "harsh"; v2.1 dials both back so
//          large smooth regions (skin, sky) stay smooth.
//
//       2. Gentle unsharp mask (sharpen sigma=0.8, m1=0.3, m2=1.5)
//          replaces v1's `blur(0.4)`. v2's m2=2.5 was too sharp on real
//          ZD410 prints — gave faces a "crispy" feel. v2.1 keeps the
//          edge boost but at half the gain, so important transitions
//          (eyes/glasses/hair) still cross the dither threshold cleanly
//          without ramping up texture in skin.
//
//       3. Light post-blur (blur sigma=0.3) AFTER sharpen. Counter-
//          intuitive but works: unsharp lifts edges then the small
//          Gaussian smooths the leftover micro-noise into tonal
//          gradients. v1's blur was before everything and just killed
//          detail; v2.1's blur is at the end and only kills grain.
//
//       4. Serpentine Atkinson — same kernel, scans right-to-left on
//          odd rows. Error diffusion's directional artefacts (the
//          "smearing trails" v1 produced through hair and skin gradients)
//          come from always pushing error rightward and down-right;
//          alternating direction cancels them across pairs of rows.
//
//       5. Per-pixel ±2 threshold jitter via a cheap (x,y) hash. v1
//          compared every pixel to 128; flat midtone regions then
//          dithered into a visible 50% checkerboard. The small jitter
//          breaks regular patterns into film-grain texture without
//          shifting the average dot density. v2 used ±3, v2.1 dials
//          to ±2 so jitter doesn't compound with unsharp into noise.
//
//     Threshold and Floyd-Steinberg modes stay close to v1 — the v1
//     failure modes that motivated this rewrite all live on the
//     Atkinson photo path.
//
// Rollback / opt-in: default is v1; set `BINARIZE_PIPELINE=v2` to try
// the experimental v2 path. The switch is checked per-call so flipping
// env + redeploy is the entire rollover path either direction.

import sharp from "sharp";
import { binarizeForThermalV1 } from "./binarize.v1";

export const DOODLE_SIZE = 592;

export type BinarizeMode = "threshold" | "floyd-steinberg" | "atkinson";

export type BinarizeOptions = {
  mode: BinarizeMode;
  threshold?: number;
};

// v1 is the production default (validated on real ZD410 prints — Stan
// tested v2 / v2.1 against v1 on three different photos and chose v1
// as "most natural" for thermal output). v2 stays in tree as an opt-in
// experiment via BINARIZE_PIPELINE=v2 for future tinkering.
function useV2(): boolean {
  return process.env.BINARIZE_PIPELINE === "v2";
}

// Deterministic (x,y) hash producing values in [-1, 1]. Cheap enough to
// run per-pixel; the bit-mixing pattern below is xxhash-style and gives
// adequate decorrelation for ±3 threshold jitter — we are not asking it
// to look like real blue noise, just to break up regular dither cells.
function jitter(x: number, y: number): number {
  let h = (x * 0x9e3779b1) ^ (y * 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

function serpentineAtkinson(gray: Buffer, w: number, h: number): Uint8Array {
  // Atkinson kernel (1/8 each, six neighbours; 2/8 of error discarded):
  //
  //     . *  1  1
  //     1 1  1
  //          1
  //
  // Forward (LTR) row diffuses to the right and down-right.
  // Reverse (RTL) row mirrors the kernel left and down-left, so the
  // accumulated directional bias cancels across each row pair.
  const buf = new Float32Array(gray);
  for (let y = 0; y < h; y++) {
    const ltr = (y & 1) === 0;
    const xStart = ltr ? 0 : w - 1;
    const xEnd = ltr ? w : -1;
    const step = ltr ? 1 : -1;
    for (let x = xStart; x !== xEnd; x += step) {
      const i = y * w + x;
      const old = buf[i];
      const t = 128 + jitter(x, y) * 2;
      const next = old < t ? 0 : 255;
      buf[i] = next;
      const err = (old - next) / 8;
      if (ltr) {
        if (x + 1 < w) buf[i + 1] += err;
        if (x + 2 < w) buf[i + 2] += err;
        if (y + 1 < h) {
          if (x > 0) buf[i + w - 1] += err;
          buf[i + w] += err;
          if (x + 1 < w) buf[i + w + 1] += err;
        }
        if (y + 2 < h) buf[i + 2 * w] += err;
      } else {
        if (x - 1 >= 0) buf[i - 1] += err;
        if (x - 2 >= 0) buf[i - 2] += err;
        if (y + 1 < h) {
          if (x + 1 < w) buf[i + w + 1] += err;
          buf[i + w] += err;
          if (x - 1 >= 0) buf[i + w - 1] += err;
        }
        if (y + 2 < h) buf[i + 2 * w] += err;
      }
    }
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] < 128 ? 0 : 255;
  return out;
}

function floydSteinberg(gray: Buffer, w: number, h: number): Uint8Array {
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

async function binarizeForThermalV2(
  rawImage: Buffer,
  opts: BinarizeOptions,
): Promise<Buffer> {
  if (opts.mode === "threshold") {
    // Line-art path: same as v1 but with CLAHE replacing the implicit
    // global contrast — line art still benefits from per-tile contrast
    // (e.g. AI-generated drawings with grey backgrounds).
    const gray = await sharp(rawImage)
      .resize(DOODLE_SIZE, DOODLE_SIZE, { fit: "cover" })
      .grayscale()
      .clahe({ width: 48, height: 48, maxSlope: 2 })
      .sharpen({ sigma: 1 })
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

  // Photo path v2.1 — CLAHE (gentler) + light unsharp + post-blur +
  // serpentine atkinson + small threshold jitter. See header for the
  // per-step rationale (v2.1 dial-back vs v2 first cut).
  const gray = await sharp(rawImage)
    .resize(DOODLE_SIZE, DOODLE_SIZE, { fit: "cover" })
    .grayscale()
    .normalize()
    .clahe({ width: 48, height: 48, maxSlope: 2 })
    .sharpen({ sigma: 0.8, m1: 0.3, m2: 1.5 })
    .blur(0.3)
    .raw()
    .toBuffer();

  const dithered =
    opts.mode === "atkinson"
      ? serpentineAtkinson(gray, DOODLE_SIZE, DOODLE_SIZE)
      : floydSteinberg(gray, DOODLE_SIZE, DOODLE_SIZE);

  return sharp(Buffer.from(dithered), {
    raw: { width: DOODLE_SIZE, height: DOODLE_SIZE, channels: 1 },
  })
    .png()
    .toBuffer();
}

export async function binarizeForThermal(
  rawImage: Buffer,
  opts: BinarizeOptions,
): Promise<Buffer> {
  if (useV2()) return binarizeForThermalV2(rawImage, opts);
  return binarizeForThermalV1(rawImage, opts);
}
