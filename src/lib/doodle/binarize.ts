// src/lib/doodle/binarize.ts
//
// 300dpi 1-bit thermal preprocessing pipeline. Three generations live here
// and `binarizeForThermal` picks one per call:
//
//   * v1 — the tone Stan signed off on. Frozen snapshot in `./binarize.v1.ts`.
//     Recipe: normalize + linear(0.85, 25) + blur(0.4) + Atkinson LTR.
//     Validated live on ZD410 (OL802/OL817/OL824/OL825) and on three test
//     photos (Doubao North Face / 吃面妹子 / 戴眼镜哥 / 模糊吃饭照). Stan
//     eyeballed v1 vs v2/v2.1 on real thermal paper and picked v1 as "most
//     natural" — v2's CLAHE+unsharp gains detail but reads too harsh /
//     crispy on thermal stock. Still used verbatim for `threshold` (line-art)
//     mode and as the hard rollback (`BINARIZE_PIPELINE=v1`).
//
//   * v2 — the CLAHE path. Aimed at the v1 failure modes on faces and busy
//     photo subjects at 300dpi:
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
//     Routing history. 2026-08-03: customer night-time uploads (dim
//     ambient light, subject lit by phone flash) printed as near-solid-
//     black cups — v1's single global stretch has nowhere to go when the
//     histogram is a spike of near-black plus a few highlights — so dark
//     sources (grayscale mean of a 64×64 thumbnail < 70) were routed to
//     v2. 2026-08-04: the mean-only rule missed bright-subject-on-black
//     (cinema seats, night street, dark clothing); sampling 84 real
//     uploads the mean caught 8 while 35 more had ≥25% of the frame in
//     deep shadow, so that shadow-mass metric was OR-ed in. The same fix
//     added a shadow-only tone curve after CLAHE (knee 80 → [30, 80],
//     gamma 0.70) because Atkinson's discarded 2/8 error lets dark
//     regions collapse to solid black; that curve survives below as the
//     fallback for sources the v3 lift declines (see `applyShadowCurve`).
//
//     Rejected then and still: switching the photo path to Floyd-
//     Steinberg. It diffuses the full error so shadows keep gradation,
//     but side by side on the real failure cases it turns the whole image
//     into a flat grey wash and throws away the contrast Stan chose
//     Atkinson for.
//
//   * v3 (2026-09-06, the default for photos) — v1's tone, plus the
//     region-aware shadow lift in `./shadow-lift.ts`, dithered with the
//     serpentine Atkinson from v2. Rick reported that photos with SOME
//     dark area — a black dress, a black car, dark hair on a bright
//     background — still print those areas as solid black. Those photos
//     have <25% of the frame in shadow and a healthy mean, so they never
//     reached the CLAHE route, and v1 has no shadow handling at all: its
//     black is `linear(0.85,25)` = 25 → ~90% nominal dot coverage, which
//     thermal dot gain turns into 100% on paper. Even the v2 curve's floor
//     of 30 (~88%) came back from the printer as "mud". v3 therefore:
//
//       - holds an ink limit of ~72% nominal coverage (FLOOR 72) so every
//         black region keeps white dots to bleed into, and re-expands the
//         tones below 128 so deep-shadow structure separates;
//       - applies that curve only inside LARGE deep-shadow regions (a
//         morphological opening drops anything thinner than 9 dots), so
//         outlines, text strokes, eyes and other small solid-black detail
//         print exactly as before, and the tone at/above 128 is bit-
//         identical to v1's — highlights and midtones cannot move;
//       - skips images whose dark regions are flat graphic fills (stamp
//         skies, bold display text, logo blocks): lifting intentional ink
//         only greys it out. The shading test and its thresholds were
//         tuned on 80 real uploads + 30 Doubao originals; see the module
//         header of shadow-lift.ts for the numbers.
//
//     The same lift replaces the global curve on the v2 route (its base
//     tone there is identity, since CLAHE already set the range), with the
//     2026-08-04 curve kept as the fallback when the lift declines, so
//     flat-fill sources on that route print exactly as they did before.
//
// Rollback / opt-in, all via `BINARIZE_PIPELINE`, checked per call so
// flipping env + redeploy is the entire rollover path either direction:
//   "legacy" → 2026-08-04 behaviour (v1 default, v2+global curve for
//              shadow-heavy sources), i.e. v3 and the region lift off;
//   "v1"     → v1 for everything (the frozen snapshot);
//   "v2"     → v2 for everything (the CLAHE experiment, with the lift).

import sharp from "sharp";
import { binarizeForThermalV1 } from "./binarize.v1";
import { applyRegionShadowLift } from "./shadow-lift";

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

// Either failure shape wants the CLAHE route: the whole frame is
// underexposed, OR a big slice of it is crushed while the rest is correctly
// exposed.
function shouldRecoverShadows(probe: SourceProbe): boolean {
  return (
    probe.mean < DARK_MEAN_THRESHOLD ||
    probe.shadowFraction >= SHADOW_FRACTION_THRESHOLD
  );
}

export async function needsShadowRecovery(rawImage: Buffer): Promise<boolean> {
  const probe = await probeSource(rawImage);
  return probe ? shouldRecoverShadows(probe) : false;
}

// The 2026-08-04 shadow-recovery curve for the CLAHE route. Everything at or
// above SHADOW_KNEE passes through untouched; below the knee the range is
// re-expanded into [SHADOW_FLOOR, knee] with gamma < 1. Superseded as the
// primary fix by the region-aware lift (floor 30 ≈ 88% coverage still
// printed as mud once dot gain had its say), but kept as the v2 fallback for
// sources the lift declines — flat graphic fills — so those keep printing
// exactly as they did.
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

function applyShadowCurve(gray: Uint8Array): Uint8Array {
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = SHADOW_LUT[gray[i]];
  return out;
}

// v1's tone, `linear(0.85, 25)`, as a function. v3 applies it through the
// lift's lookup table instead of sharp so the lifted curve can be blended
// against it per pixel; at and above the lift's knee the two are identical.
const V1_TONE = (v: number) => 0.85 * v + 25;

type ForcedPipeline = "legacy" | "v1" | "v2" | null;

function forcedPipeline(): ForcedPipeline {
  const v = process.env.BINARIZE_PIPELINE;
  return v === "legacy" || v === "v1" || v === "v2" ? v : null;
}

// Deterministic (x,y) hash producing values in [-1, 1]. Cheap enough to
// run per-pixel; the bit-mixing pattern below is xxhash-style and gives
// adequate decorrelation for ±2 threshold jitter — we are not asking it
// to look like real blue noise, just to break up regular dither cells.
function jitter(x: number, y: number): number {
  let h = (x * 0x9e3779b1) ^ (y * 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

/**
 * Serpentine Atkinson with ±2 threshold jitter — the dither used by the v2
 * and v3 photo paths. Exported so calibration tooling (scripts/
 * print-tone-wedge.ts) can dither a known-coverage target exactly the way a
 * photo label is dithered.
 */
export function serpentineAtkinson(
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

function toPng(bin: Uint8Array): Promise<Buffer> {
  return sharp(Buffer.from(bin), {
    raw: { width: DOODLE_SIZE, height: DOODLE_SIZE, channels: 1 },
  })
    .png()
    .toBuffer();
}

function dither(gray: Uint8Array, mode: BinarizeMode): Uint8Array {
  return mode === "atkinson"
    ? serpentineAtkinson(gray, DOODLE_SIZE, DOODLE_SIZE)
    : floydSteinberg(gray, DOODLE_SIZE, DOODLE_SIZE);
}

async function binarizeForThermalV2(
  rawImage: Buffer,
  opts: BinarizeOptions,
  regionLift: boolean,
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
    const bin = new Uint8Array(gray.length);
    for (let i = 0; i < bin.length; i++) bin[i] = gray[i] < t ? 0 : 255;
    return toPng(bin);
  }

  // Photo path v2.1 — CLAHE (gentler) + light unsharp + post-blur, then the
  // shadow treatment, then serpentine Atkinson with small threshold jitter.
  // See the header for the per-step rationale (v2.1 dial-back vs v2).
  const gray = new Uint8Array(
    await sharp(rawImage)
      .resize(DOODLE_SIZE, DOODLE_SIZE, { fit: "cover" })
      .grayscale()
      .normalize()
      .clahe({ width: 48, height: 48, maxSlope: 2 })
      .sharpen({ sigma: 0.8, m1: 0.3, m2: 1.5 })
      .blur(0.3)
      .raw()
      .toBuffer(),
  );

  // CLAHE has surfaced whatever local structure the shadows hold, but much
  // of it still sits below the dither threshold. The region lift pulls the
  // large shaded regions across it and holds the ink limit; when it declines
  // (flat graphic fills, or no large dark region at all) the 2026-08-04
  // global curve runs instead, so those sources print exactly as before.
  let toned: Uint8Array | null = null;
  if (regionLift) {
    const lift = applyRegionShadowLift(gray, DOODLE_SIZE, DOODLE_SIZE, (v) => v);
    if (lift.lifted) toned = lift.out;
  }
  if (!toned) toned = applyShadowCurve(gray);

  return toPng(dither(toned, opts.mode));
}

// v3 — v1's tone with the region-aware shadow lift. `normalize` / `blur`
// are v1's; `linear(0.85, 25)` moved into the lift's lookup table (both
// are per-pixel affine maps, so the order against blur/grayscale does not
// matter) so it can be blended per pixel against the lifted curve.
async function binarizeForThermalV3(
  rawImage: Buffer,
  opts: BinarizeOptions,
): Promise<Buffer> {
  const gray = new Uint8Array(
    await sharp(rawImage)
      .resize(DOODLE_SIZE, DOODLE_SIZE, { fit: "cover" })
      .normalize()
      .grayscale()
      .blur(0.4)
      .raw()
      .toBuffer(),
  );
  const { out } = applyRegionShadowLift(gray, DOODLE_SIZE, DOODLE_SIZE, V1_TONE);
  return toPng(dither(out, opts.mode));
}

export async function binarizeForThermal(
  rawImage: Buffer,
  opts: BinarizeOptions,
): Promise<Buffer> {
  const forced = forcedPipeline();
  if (forced === "v1") return binarizeForThermalV1(rawImage, opts);
  if (forced === "v2") return binarizeForThermalV2(rawImage, opts, true);

  const regionLift = forced !== "legacy";
  const probe = await probeSource(rawImage);
  if (probe && shouldRecoverShadows(probe)) {
    return binarizeForThermalV2(rawImage, opts, regionLift);
  }
  // Line art (threshold mode) has no shadows to lift; v1 stays the exact
  // pipeline the static gallery and the logo were produced with.
  if (!regionLift || opts.mode === "threshold") {
    return binarizeForThermalV1(rawImage, opts);
  }
  return binarizeForThermalV3(rawImage, opts);
}
