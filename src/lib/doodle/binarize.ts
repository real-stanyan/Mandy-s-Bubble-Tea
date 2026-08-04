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
//
// Auto-dark-source routing (2026-08-03): customer night-time photo
// uploads (dim ambient light, subject lit mostly by phone flash) were
// printing as near-solid-black cups. v1's contrast recipe is a single
// global `normalize() + linear(0.85, 25)` stretch — for a night photo
// whose histogram is a big spike of near-black pixels plus a few bright
// highlights, that global stretch has nowhere to go (the highlights
// already anchor the top of the range) and the shadow-heavy midtones
// stay under the dither threshold. v2's CLAHE step fixes exactly this
// (per-tile local contrast instead of one global curve) but was kept
// opt-in because Stan judged it "too crispy" on ordinarily-lit photos.
// Rather than flip the global default, we cheaply estimate source
// brightness (grayscale mean of a 64x64 thumbnail — a few ms, no full-res
// decode) and only route genuinely dark sources through the v2 path;
// normally-lit photos are unaffected and keep going through v1.
//
// Shadow recovery (2026-08-04): Stan reported prints where "the bright areas
// are fine now, the dark areas are still mud". Two separate causes:
//
//   1. The mean-only routing rule missed the failure class. A photo with a
//      bright subject against a black background (cinema seats, night street,
//      dark clothing) averages well above 70, so it went down v1 — which has
//      no local-contrast step whatsoever. Sampling 84 real uploads: the mean
//      rule caught 8; another 35 had >=25% of the frame in deep shadow and
//      were being sent to v1. Routing now ORs in that shadow-mass metric.
//
//   2. Even on the v2 path, shadows still clipped. Atkinson only propagates
//      6/8 of the quantisation error (2/8 is discarded — that discard is what
//      gives it its punch), so in a dark region the running error never
//      accumulates enough to flip a pixel white and the whole area collapses
//      to solid black. A shadow-only tone curve (see SHADOW_LUT) now runs
//      after CLAHE and lifts that band above the dither threshold while
//      leaving everything above the knee bit-identical.
//
// Rejected: switching the photo path to Floyd-Steinberg. It diffuses the full
// error so shadows do keep their gradation, but rendered side by side on the
// real failure cases it turns the whole image into a flat grey wash and throws
// away the contrast Stan chose Atkinson for.

import sharp from "sharp";
import { binarizeForThermalV1 } from "./binarize.v1";

export const DOODLE_SIZE = 592;

export type BinarizeMode = "threshold" | "floyd-steinberg" | "atkinson";

export type BinarizeOptions = {
  mode: BinarizeMode;
  threshold?: number;
};

// Grayscale mean (0-255) below which a source is treated as underexposed.
// Tuned heuristic, not measured from a labeled dataset — revisit if real
// night-order prints still come out too dark/too crispy.
const DARK_MEAN_THRESHOLD = 70;

// A pixel at or below this level is "deep shadow" — the zone that clips to a
// solid black slab once Atkinson has thrown away its 2/8 of the error.
const SHADOW_LEVEL = 64;

// Fraction of the frame that has to sit in deep shadow before we treat the
// photo as needing shadow recovery even though its overall mean looks fine.
// Measured on 84 real customer uploads (2026-08-04): the mean-only rule caught
// 8, while another 35 had >=25% of the frame in deep shadow yet a mean well
// above 70 — bright subject, black background. Those are exactly the prints
// that come back as "highlights fine, dark areas a mud slab", because a high
// mean sent them down v1, which has no local-contrast step at all.
const SHADOW_FRACTION_THRESHOLD = 0.25;

type SourceProbe = { mean: number; shadowFraction: number };

// Cheap tone probe: shrink-on-load to a tiny thumbnail so this stays fast even
// for large phone photos, then walk the pixels once for both metrics. Reading
// raw (rather than .stats()) costs the same decode but also gives us the
// shadow histogram mass, which the mean alone hides.
async function probeSource(rawImage: Buffer): Promise<SourceProbe | null> {
  try {
    const px = await sharp(rawImage)
      .resize(64, 64, { fit: "inside" })
      .grayscale()
      .raw()
      .toBuffer();
    let sum = 0;
    let shadow = 0;
    for (const v of px) {
      sum += v;
      if (v < SHADOW_LEVEL) shadow++;
    }
    return { mean: sum / px.length, shadowFraction: shadow / px.length };
  } catch {
    return null;
  }
}

// Kept as its own export because it names a distinct property of the source
// (globally underexposed, e.g. a night photo) that the tests assert directly.
// Unreadable/corrupt input falls through to the normal v1 path, which will
// surface the same decode error upload-image/route.ts already handles.
export async function isDarkSource(rawImage: Buffer): Promise<boolean> {
  const probe = await probeSource(rawImage);
  return probe ? probe.mean < DARK_MEAN_THRESHOLD : false;
}

// Either failure shape wants the same treatment (local contrast + a shadow
// curve): the whole frame is underexposed, OR a big slice of it is crushed
// while the rest is correctly exposed.
export async function needsShadowRecovery(rawImage: Buffer): Promise<boolean> {
  const probe = await probeSource(rawImage);
  if (!probe) return false;
  return (
    probe.mean < DARK_MEAN_THRESHOLD ||
    probe.shadowFraction >= SHADOW_FRACTION_THRESHOLD
  );
}

// Shadow-recovery tone curve, applied after CLAHE and before dithering.
//
// Two jobs, one LUT:
//
//   * Everything at or above SHADOW_KNEE passes through untouched. Stan signed
//     off on the current highlight/midtone rendition, so the curve is built so
//     it *cannot* move them — the fix is confined to the tones that are broken.
//
//   * Below the knee the range is re-expanded into [SHADOW_FLOOR, knee] with
//     gamma < 1. Deep-shadow detail that CLAHE surfaced but that still sat
//     under the dither threshold gets pulled across it, so a black region
//     resolves into shapes instead of one slab.
//
// SHADOW_FLOOR doubles as an ink limit: with a floor of 30 the darkest pixel
// prints at ~88% dot coverage instead of 100%, so solid black keeps a sprinkle
// of white dots. That matters more on thermal than on screen — adjacent black
// dots bleed into each other on the paper, and a region printed at a true 100%
// has no white left to bleed into, which is what turns it into an
// undifferentiated burn.
//
// knee=80 / floor=30 / gamma=0.70 was picked by rendering a sweep over real
// customer uploads (dark cinema selfie + mid-key regression case). Lower knees
// left the shadows still closed; knee=96+ started washing midtones grey and
// losing the punch that made Stan pick Atkinson over Floyd-Steinberg in the
// first place. It errs slightly open on screen on purpose: thermal dot gain
// prints darker than the preview.
const SHADOW_KNEE = 80;
const SHADOW_FLOOR = 30;
const SHADOW_GAMMA = 0.7;

const SHADOW_LUT = (() => {
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    lut[v] =
      v >= SHADOW_KNEE
        ? v
        : Math.round(
            SHADOW_FLOOR +
              Math.pow(v / SHADOW_KNEE, SHADOW_GAMMA) *
                (SHADOW_KNEE - SHADOW_FLOOR),
          );
  }
  return lut;
})();

function applyShadowCurve(gray: Buffer): Uint8Array {
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = SHADOW_LUT[gray[i]];
  return out;
}

// v1 is the production default (validated on real ZD410 prints — Stan
// tested v2 / v2.1 against v1 on three different photos and chose v1
// as "most natural" for thermal output). v2 stays in tree as an opt-in
// experiment via BINARIZE_PIPELINE=v2 for future tinkering.
function isV2Enabled(): boolean {
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

function serpentineAtkinson(
  gray: Uint8Array,
  w: number,
  h: number,
): Uint8Array {
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

function floydSteinberg(gray: Uint8Array, w: number, h: number): Uint8Array {
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

  // Photo path v2.1 — CLAHE (gentler) + light unsharp + post-blur + shadow
  // curve + serpentine atkinson + small threshold jitter. See header for the
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

  // Last step before dithering: CLAHE has already surfaced whatever local
  // structure the shadows hold, but much of it still sits below the dither
  // threshold. The curve lifts that band across it (and holds a white floor
  // so black regions keep texture) without touching anything above the knee.
  const toned = applyShadowCurve(gray);

  const dithered =
    opts.mode === "atkinson"
      ? serpentineAtkinson(toned, DOODLE_SIZE, DOODLE_SIZE)
      : floydSteinberg(toned, DOODLE_SIZE, DOODLE_SIZE);

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
  if (isV2Enabled()) return binarizeForThermalV2(rawImage, opts);
  if (await needsShadowRecovery(rawImage)) {
    return binarizeForThermalV2(rawImage, opts);
  }
  return binarizeForThermalV1(rawImage, opts);
}
