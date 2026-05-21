// src/lib/cup-label/mandy-logo.ts
//
// Pre-binarised Mandy logo packed as a ZPL ^GFA hex block. Sits in the
// top-left of the cup-label header (black band) to the left of the
// "Hi, {name}" greeting. We pre-compute once at module load and cache
// the packed bytes so each label render is a string concat, not a sharp
// pipeline.
//
// Visual: source PNG is a transparent-bg illustration of a girl holding
// a bubble-tea cup (dark outlines, light fill). After resize + flatten
// to white + grayscale + threshold + 1-bit pack, the dark outlines
// become "print bit 1". Combined with ZPL ^FR (field reverse) in the
// renderer, those print-bits paint WHITE on the already-black band so
// the logo reads as a white outline silhouette.
//
// Re-binarising at module load (not at every render) keeps the hot path
// hash-only. Lazy via a top-level Promise so importers get a stable
// awaited result.

import "server-only";
import path from "node:path";
import { promises as fs } from "node:fs";
import sharp from "sharp";

export const MANDY_LOGO_WIDTH = 88; // must be a multiple of 8 for ^GFA
export const MANDY_LOGO_HEIGHT = 100;

export interface MandyLogoZpl {
  hex: string;
  totalBytes: number;
  widthBytes: number;
}

let cached: Promise<MandyLogoZpl> | null = null;

export function getMandyLogoZpl(): Promise<MandyLogoZpl> {
  if (!cached) cached = build();
  return cached;
}

async function build(): Promise<MandyLogoZpl> {
  const buf = await fs.readFile(
    path.join(process.cwd(), "src", "lib", "cup-label", "mandy-logo.png"),
  );
  // Resize keeping aspect inside the box, flatten transparency onto
  // white so transparent → "no print" later (bit 0 / band-black shows
  // through). Grayscale + threshold gives a clean 1-bit mask.
  const raw = await sharp(buf)
    .resize(MANDY_LOGO_WIDTH, MANDY_LOGO_HEIGHT, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .flatten({ background: "#ffffff" })
    .grayscale()
    .threshold(128)
    .raw()
    .toBuffer();
  const bytes = packTo1Bit(raw, MANDY_LOGO_WIDTH, MANDY_LOGO_HEIGHT);
  return {
    hex: bytes.toString("hex").toUpperCase(),
    totalBytes: bytes.length,
    widthBytes: MANDY_LOGO_WIDTH / 8,
  };
}

// Mirror of packTo1Bit in render-zebra-cup.ts; kept local to avoid a
// circular import.
function packTo1Bit(grayscale: Buffer, w: number, h: number): Buffer {
  const widthBytes = w / 8;
  const out = Buffer.alloc(widthBytes * h, 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = grayscale[y * w + x];
      if (px < 128) {
        const byte = y * widthBytes + (x >>> 3);
        out[byte] |= 0x80 >>> (x & 7);
      }
    }
  }
  return out;
}
