// src/lib/cup-label/recipes.ts
import "server-only";
import sharp from "sharp";
import { binarizeForThermal, DOODLE_SIZE } from "@/lib/doodle/binarize";

const VALUE_CHANNEL_THRESHOLD = 200;
const INK_LINE_THRESHOLD = 70;

export async function valueChannelPng(src: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(src)
    .resize({ width: DOODLE_SIZE, height: DOODLE_SIZE, fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = info.width * info.height;
  const out = Buffer.alloc(px * 3);
  for (let i = 0; i < px; i++) {
    const v = Math.max(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]);
    out[i * 3] = v; out[i * 3 + 1] = v; out[i * 3 + 2] = v;
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer();
}

export async function inkLineBinarized(src: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(src)
    .resize({ width: DOODLE_SIZE, height: DOODLE_SIZE, fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .removeAlpha().grayscale().blur(0.6).raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height);
  for (let i = 0; i < out.length; i++) out[i] = data[i] < INK_LINE_THRESHOLD ? 0 : 255;
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 1 } }).median(3).png().toBuffer();
}

// Pre-stretch contrast (auto levels) then dither — recovers faded/low-contrast scans.
async function highContrast(src: Buffer): Promise<Buffer> {
  const pre = await sharp(src).normalise().png().toBuffer();
  return binarizeForThermal(pre, { mode: "atkinson" });
}

// Darken before dither so more pixels cross to black — bolder, thicker lines.
async function bolder(src: Buffer): Promise<Buffer> {
  const pre = await sharp(src).linear(1.1, -28).png().toBuffer();
  return binarizeForThermal(pre, { mode: "atkinson" });
}

export type RecipeId = "default" | "high-contrast" | "bolder" | "ink-line" | "drop-bg";

export const RECIPES: ReadonlyArray<{ id: RecipeId; label: string; run(src: Buffer): Promise<Buffer> }> = [
  { id: "default", label: "默认", run: (s) => binarizeForThermal(s, { mode: "atkinson" }) },
  { id: "high-contrast", label: "高对比", run: highContrast },
  { id: "bolder", label: "加重", run: bolder },
  { id: "ink-line", label: "线稿提取", run: inkLineBinarized },
  { id: "drop-bg", label: "去彩底", run: async (s) => binarizeForThermal(await valueChannelPng(s), { mode: "threshold", threshold: VALUE_CHANNEL_THRESHOLD }) },
];

export function getRecipe(id: string): (typeof RECIPES)[number] | null {
  return RECIPES.find((r) => r.id === id) ?? null;
}

// ── Parametric reprocessing ────────────────────────────────────────────────
// The 5 RECIPES above stay pixel-exact (preset buttons send recipeId). The
// sliders send a ReprocessParams object instead, which runs a single tunable
// pipeline: linear(contrast, brightness) → optional blur → binarize. Each
// preset also has a nominal param set (PRESET_PARAMS) so clicking a preset can
// seed the sliders for fine-tuning.

export type DitherMode = "atkinson" | "threshold";

export type ReprocessParams = {
  contrast: number; // sharp linear() multiplier — output = contrast*in + brightness
  brightness: number; // linear() offset; negative darkens → bolder lines
  blur: number; // pre-blur sigma (sharp needs ≥0.3; 0 = off)
  threshold: number; // 0–255, used in threshold mode only
  mode: DitherMode;
};

export const PARAM_BOUNDS = {
  contrast: { min: 0.5, max: 2.0, step: 0.05, default: 1.0 },
  brightness: { min: -80, max: 40, step: 1, default: 0 },
  blur: { min: 0, max: 2, step: 0.1, default: 0 },
  threshold: { min: 0, max: 255, step: 1, default: VALUE_CHANNEL_THRESHOLD },
} as const;

const MIN_BLUR_SIGMA = 0.3; // sharp.blur() throws below this

export function clampParams(p: Partial<ReprocessParams> | null | undefined): ReprocessParams {
  const num = (v: unknown, b: { min: number; max: number; default: number }) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(b.max, Math.max(b.min, v)) : b.default;
  return {
    contrast: num(p?.contrast, PARAM_BOUNDS.contrast),
    brightness: num(p?.brightness, PARAM_BOUNDS.brightness),
    blur: num(p?.blur, PARAM_BOUNDS.blur),
    threshold: Math.round(num(p?.threshold, PARAM_BOUNDS.threshold)),
    mode: p?.mode === "threshold" ? "threshold" : "atkinson",
  };
}

// Nominal param seed per preset (sliders load these on preset click). These
// approximate each recipe in linear-space; the preset BUTTON still runs the
// exact recipe, so there is no regression — these only pre-fill the sliders.
export const PRESET_PARAMS: Record<RecipeId, ReprocessParams> = {
  default: { contrast: 1.0, brightness: 0, blur: 0, threshold: 200, mode: "atkinson" },
  "high-contrast": { contrast: 1.35, brightness: 10, blur: 0, threshold: 200, mode: "atkinson" },
  bolder: { contrast: 1.1, brightness: -28, blur: 0, threshold: 200, mode: "atkinson" },
  "ink-line": { contrast: 1.2, brightness: -10, blur: 0.6, threshold: 70, mode: "threshold" },
  "drop-bg": { contrast: 1.0, brightness: 0, blur: 0, threshold: VALUE_CHANNEL_THRESHOLD, mode: "threshold" },
};

export async function runParametric(src: Buffer, raw: Partial<ReprocessParams> | null | undefined): Promise<Buffer> {
  const p = clampParams(raw);
  let pre = sharp(src).linear(p.contrast, p.brightness);
  if (p.blur >= MIN_BLUR_SIGMA) pre = pre.blur(p.blur);
  const preBuf = await pre.png().toBuffer();
  return binarizeForThermal(preBuf, p.mode === "threshold" ? { mode: "threshold", threshold: p.threshold } : { mode: "atkinson" });
}

export async function colorThumb(src: Buffer): Promise<Buffer> {
  return sharp(src)
    .resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}
