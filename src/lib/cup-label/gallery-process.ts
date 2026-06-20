import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { binarizeForThermal } from "@/lib/doodle/binarize";

export function md5Hex(buf: Buffer): string {
  return createHash("md5").update(buf).digest("hex");
}

/**
 * Raw uploaded image → the two artifacts the gallery stores:
 *   binarizedPng — 592×592 1-bit, the ZD410 print image (same pipeline as
 *                  customer photo uploads / the static 235).
 *   colorPng     — 480px-wide color thumbnail for the picker.
 * hash = md5 of the raw bytes (content-addressed, matches the static scheme).
 */
export async function processGalleryImage(
  raw: Buffer,
): Promise<{ hash: string; colorPng: Buffer; binarizedPng: Buffer }> {
  const hash = md5Hex(raw);
  const binarizedPng = await binarizeForThermal(raw, { mode: "atkinson" });
  const colorPng = await sharp(raw)
    .resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  return { hash, colorPng, binarizedPng };
}
