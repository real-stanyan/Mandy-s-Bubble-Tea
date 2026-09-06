// src/lib/doodle/shadow-lift.ts
//
// Region-aware shadow lift for the 1-bit thermal pipeline (binarize.ts).
//
// The complaint it answers (2026-09-06): customer photos with big dark areas
// — black clothing, dark hair, a black car, a face in shadow — print as one
// solid black slab on the ZD410 even though the screen preview shows some
// texture. Two physical causes, neither visible on screen:
//
//   1. Thermal dot gain. Every printed dot bleeds into its neighbours, so a
//      region dithered at 88% nominal coverage lands on paper at ~95%+ and
//      reads as solid black. On this stock anything darker than roughly 75%
//      nominal coverage is unrecoverable ink.
//   2. Atkinson dithering discards 2/8 of the quantisation error, so inside a
//      dark region the running error never accumulates enough to flip pixels
//      white; the region collapses to 100% before the tone curve is even a
//      factor.
//
// The fix is a tone curve applied ONLY where it is needed:
//
//   * Which pixels. A pixel qualifies when it sits inside a LARGE deep-shadow
//     region: darker than MASK_LEVEL, after a morphological opening that
//     erases anything thinner than 2·OPEN_RADIUS+1 dots (9 dots ≈ 0.75 mm at
//     300 dpi). Thin lines, cartoon outlines, text strokes, eyes, eyelashes
//     — the things that should print solid black — are never touched. The
//     mask is feathered so the lift has no visible seams.
//   * Which images. A flat graphic fill (a stamp's black sky, bold display
//     text, a logo block) is intentional ink; lifting it only greys it out.
//     So the lift is enabled per image only when the dark regions actually
//     hold shading: the 90th percentile of coarse tone std inside the regions
//     has to clear a threshold. Graphic-looking sources (few midtones) need
//     more evidence than photographic ones. Measured on 80 real customer
//     uploads + 30 Doubao originals (2026-09-06): stamp/poster fills sit at
//     p90 ≤ 3.3, smooth photographic shadows (a felt hat, a still pool) at
//     3.3–5.3, textured ones (fabric, hair, car paint) at 6–15.
//   * What the curve does. Below KNEE the tone range is re-expanded into
//     [FLOOR, base(KNEE)] with GAMMA < 1, so the deepest shadows get the most
//     separation. FLOOR is the ink limit: the darkest lifted tone prints at
//     ~72% nominal coverage, so every black region keeps white dots to bleed
//     into. At and above KNEE the curve IS the caller's base tone, so
//     highlights and midtones cannot move.
//
// Pure functions over a raw 8-bit gray buffer — no sharp — so the behaviour
// is cheap to unit test (see shadow-lift.test.ts).

export const SHADOW_LIFT = {
  /** A pixel below this level counts as deep shadow (mask candidate). */
  MASK_LEVEL: 64,
  /** Opening radius: dark structures thinner than 2r+1 dots are left solid. */
  OPEN_RADIUS: 4,
  /** Tones at or above the knee are never changed. */
  KNEE: 128,
  /** Darkest lifted tone. 72 ≈ 72% nominal dot coverage = the ink limit. */
  FLOOR: 72,
  /** < 1 expands the deepest shadows most. */
  GAMMA: 0.6,
  /** Half-width of the window the shading std is measured over (33×33). */
  TEXTURE_RADIUS: 16,
  /** A window needs this many interior pixels before its std counts. */
  TEXTURE_MIN_SAMPLES: 25,
  /** p90 shading std a photographic source must reach to be lifted. */
  FLAT_STD_PHOTO: 2.5,
  /** ...and a graphic-looking source (few midtones) must reach. */
  FLAT_STD_GRAPHIC: 5.0,
  /** Midtone fraction (40..215) at or above which a source is "photographic". */
  PHOTO_MIDTONE_FRACTION: 0.5,
  /** Below this share of the frame in large dark regions there is nothing to lift. */
  MIN_MASK_FRACTION: 0.005,
} as const;

export type ShadowLiftStats = {
  /** Share of the frame covered by large deep-shadow regions (after opening). */
  maskFraction: number;
  /** 90th percentile of the coarse tone std inside those regions. */
  textureP90: number;
  /** Share of pixels in 40..215. */
  midtoneFraction: number;
};

export type ShadowLiftResult = {
  /** Base-toned gray, with the shadow lift blended in where it applies. */
  out: Uint8Array;
  /** false = flat fills / no large dark regions; `out` is just base(gray). */
  lifted: boolean;
  stats: ShadowLiftStats;
};

export type ToneFn = (v: number) => number;

/** Which p90 shading std a source must reach before its dark regions are lifted. */
export function flatStdThreshold(midtoneFraction: number): number {
  return midtoneFraction >= SHADOW_LIFT.PHOTO_MIDTONE_FRACTION
    ? SHADOW_LIFT.FLAT_STD_PHOTO
    : SHADOW_LIFT.FLAT_STD_GRAPHIC;
}

/**
 * The two 256-entry tone tables: `base` is the caller's tone (v1's
 * linear(0.85, 25), or identity on the CLAHE path) and `lifted` is the same
 * table with [0, KNEE) re-expanded into [FLOOR, base(KNEE)]. Above the knee
 * both tables are identical by construction.
 */
export function buildShadowLiftLuts(base: ToneFn): { base: Uint8Array; lifted: Uint8Array } {
  const b = new Uint8Array(256);
  const l = new Uint8Array(256);
  const clamp = (x: number) => Math.round(Math.min(255, Math.max(0, x)));
  const atKnee = clamp(base(SHADOW_LIFT.KNEE));
  for (let v = 0; v < 256; v++) {
    b[v] = clamp(base(v));
    l[v] =
      v >= SHADOW_LIFT.KNEE
        ? b[v]
        : clamp(
            SHADOW_LIFT.FLOOR +
              Math.pow(v / SHADOW_LIFT.KNEE, SHADOW_LIFT.GAMMA) * (atKnee - SHADOW_LIFT.FLOOR),
          );
  }
  return { base: b, lifted: l };
}

// Separable min (erode) / max (dilate) over a (2r+1)² window, edges clamped.
function minMaxFilter(src: Uint8Array, w: number, h: number, r: number, op: "min" | "max"): Uint8Array {
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  const isMin = op === "min";
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let m = isMin ? 255 : 0;
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w - 1, x + r);
      for (let xx = x0; xx <= x1; xx++) {
        const v = src[row + xx];
        if (isMin ? v < m : v > m) m = v;
      }
      tmp[row + x] = m;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let m = isMin ? 255 : 0;
      const y0 = Math.max(0, y - r);
      const y1 = Math.min(h - 1, y + r);
      for (let yy = y0; yy <= y1; yy++) {
        const v = tmp[yy * w + x];
        if (isMin ? v < m : v > m) m = v;
      }
      out[y * w + x] = m;
    }
  }
  return out;
}

// Separable box filter over a (2r+1)² window via prefix sums (O(N)).
//   "mean-clamp": mean with edge pixels replicated — for smoothing masks/tones.
//   "sum-zero":   plain sum with zeros outside the image — for masked sums.
function boxFilter(
  src: Float32Array,
  w: number,
  h: number,
  r: number,
  mode: "mean-clamp" | "sum-zero",
): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const win = 2 * r + 1;
  const clampEdges = mode === "mean-clamp";
  const prefix = new Float64Array(Math.max(w, h) + win + 1);

  for (let y = 0; y < h; y++) {
    const row = y * w;
    prefix[0] = 0;
    for (let k = 0; k < w + 2 * r; k++) {
      const i = k - r;
      let v: number;
      if (i >= 0 && i < w) v = src[row + i];
      else v = clampEdges ? src[row + (i < 0 ? 0 : w - 1)] : 0;
      prefix[k + 1] = prefix[k] + v;
    }
    for (let x = 0; x < w; x++) tmp[row + x] = prefix[x + win] - prefix[x];
  }
  for (let x = 0; x < w; x++) {
    prefix[0] = 0;
    for (let k = 0; k < h + 2 * r; k++) {
      const i = k - r;
      let v: number;
      if (i >= 0 && i < h) v = tmp[i * w + x];
      else v = clampEdges ? tmp[(i < 0 ? 0 : h - 1) * w + x] : 0;
      prefix[k + 1] = prefix[k] + v;
    }
    for (let y = 0; y < h; y++) out[y * w + x] = prefix[y + win] - prefix[y];
  }
  if (clampEdges) {
    const n = win * win;
    for (let i = 0; i < out.length; i++) out[i] /= n;
  }
  return out;
}

// p90 of the shading std, read off a fixed-resolution histogram so we never
// sort a few hundred thousand floats per label.
const STD_HIST_SCALE = 20; // 0.05 std per bin
const STD_HIST_BINS = 512; // covers std 0 .. 25.55

/**
 * Per-pixel blend weight (0..1) for the lift, plus the decision inputs.
 * Exported for tests; production callers use `applyRegionShadowLift`.
 */
export function shadowRegionWeight(
  gray: Uint8Array,
  w: number,
  h: number,
): { weight: Float32Array; lifted: boolean; stats: ShadowLiftStats } {
  const n = w * h;
  const { MASK_LEVEL, OPEN_RADIUS, TEXTURE_RADIUS, TEXTURE_MIN_SAMPLES, MIN_MASK_FRACTION } = SHADOW_LIFT;

  const dark = new Uint8Array(n);
  let midtones = 0;
  for (let i = 0; i < n; i++) {
    const v = gray[i];
    if (v < MASK_LEVEL) dark[i] = 1;
    if (v >= 40 && v <= 215) midtones++;
  }
  const midtoneFraction = midtones / n;

  // Large dark regions only: erode then dilate drops anything thin.
  const eroded = minMaxFilter(dark, w, h, OPEN_RADIUS, "min");
  const opened = minMaxFilter(eroded, w, h, OPEN_RADIUS, "max");
  let maskCount = 0;
  for (let i = 0; i < n; i++) maskCount += opened[i];
  const maskFraction = maskCount / n;

  const stats: ShadowLiftStats = { maskFraction, textureP90: 0, midtoneFraction };
  if (maskFraction < MIN_MASK_FRACTION) {
    return { weight: new Float32Array(n), lifted: false, stats };
  }

  // Shading inside the regions: std of the 9×9-mean tone over a 33×33
  // window, counting interior pixels only (eroded a bit further than the
  // mask so the region's own edge contrast cannot masquerade as shading).
  const inner = Float32Array.from(minMaxFilter(dark, w, h, OPEN_RADIUS + 2, "min"));
  const coarse = boxFilter(Float32Array.from(gray), w, h, 4, "mean-clamp");
  const cm = new Float32Array(n);
  const c2m = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    cm[i] = coarse[i] * inner[i];
    c2m[i] = coarse[i] * coarse[i] * inner[i];
  }
  const cnt = boxFilter(inner, w, h, TEXTURE_RADIUS, "sum-zero");
  const s1 = boxFilter(cm, w, h, TEXTURE_RADIUS, "sum-zero");
  const s2 = boxFilter(c2m, w, h, TEXTURE_RADIUS, "sum-zero");
  const hist = new Uint32Array(STD_HIST_BINS);
  let samples = 0;
  for (let i = 0; i < n; i++) {
    if (!inner[i] || cnt[i] < TEXTURE_MIN_SAMPLES) continue;
    const mean = s1[i] / cnt[i];
    const std = Math.sqrt(Math.max(0, s2[i] / cnt[i] - mean * mean));
    hist[Math.min(STD_HIST_BINS - 1, Math.floor(std * STD_HIST_SCALE))]++;
    samples++;
  }
  let textureP90 = 0;
  if (samples > 0) {
    const target = Math.ceil(samples * 0.9);
    let acc = 0;
    for (let b = 0; b < STD_HIST_BINS; b++) {
      acc += hist[b];
      if (acc >= target) {
        textureP90 = b / STD_HIST_SCALE;
        break;
      }
    }
  }
  stats.textureP90 = textureP90;

  const lifted = samples > 0 && textureP90 >= flatStdThreshold(midtoneFraction);
  if (!lifted) return { weight: new Float32Array(n), lifted: false, stats };

  // Feather the mask (two box passes ≈ a triangle kernel) so the lift fades
  // in over ~2r dots instead of stepping.
  const weight = boxFilter(
    boxFilter(Float32Array.from(opened), w, h, OPEN_RADIUS, "mean-clamp"),
    w,
    h,
    OPEN_RADIUS,
    "mean-clamp",
  );
  return { weight, lifted: true, stats };
}

/**
 * Apply `base` to every pixel, and blend the shadow-lift curve in over the
 * large shaded dark regions. `gray` is an 8-bit single-channel buffer of
 * w×h pixels; the result is the same shape, ready for dithering.
 */
export function applyRegionShadowLift(
  gray: Uint8Array,
  w: number,
  h: number,
  base: ToneFn,
): ShadowLiftResult {
  const luts = buildShadowLiftLuts(base);
  const { weight, lifted, stats } = shadowRegionWeight(gray, w, h);
  const out = new Uint8Array(gray.length);
  if (!lifted) {
    for (let i = 0; i < out.length; i++) out[i] = luts.base[gray[i]];
    return { out, lifted, stats };
  }
  for (let i = 0; i < out.length; i++) {
    const v = gray[i];
    const b = luts.base[v];
    out[i] = Math.round(b + weight[i] * (luts.lifted[v] - b));
  }
  return { out, lifted, stats };
}
