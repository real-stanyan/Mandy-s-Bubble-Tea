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

export async function colorThumb(src: Buffer): Promise<Buffer> {
  return sharp(src)
    .resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}
