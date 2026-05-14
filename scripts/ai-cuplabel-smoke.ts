// scripts/ai-cuplabel-smoke.ts
//
// Phase-1 smoke test for AI-generated cup-label printing.
//
// Pipeline:
//   1. Doubao Seedream 4.5  →  2K colour PNG
//   2. Resize 2048→DOODLE_SIZE, sharpen, grayscale
//   3. Three preprocessing variants:
//        a. threshold @ 128 (matches existing renderCupLabel pipeline)
//        b. threshold @ 160 (darker fill, useful for pale AI output)
//        c. Floyd–Steinberg dither (photo-friendly)
//   4. Pack 1-bit → ^GFA → minimal ZPL (top band label + doodle only)
//   5. Direct USB write to ZD410 via printer-client's libusb wrapper
//
// Run:
//   pnpm tsx scripts/ai-cuplabel-smoke.ts ["your prompt"]
//
// Each variant prints in sequence with a 4s pause for tear-off. Also
// dumps /tmp/ai-{variant}.{zpl,preview.png} for inspection.

import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import sharp from "sharp";

// tsx scripts run outside Next.js, so .env.local isn't auto-loaded.
loadEnv({ path: [resolve(process.cwd(), ".env.local"), resolve(process.cwd(), ".env")] });

const ARK_API_KEY = process.env.ARK_API_KEY;
if (!ARK_API_KEY) {
  console.error("missing ARK_API_KEY (set in .env.local)");
  process.exit(1);
}

const DOODLE_SIZE = 592;
const LABEL_WIDTH_DOTS = 590;
const LABEL_HEIGHT_DOTS = 945;
const TOP_BAND_HEIGHT = 120;

const PROMPT =
  process.argv[2] ??
  "a cute cartoon bubble tea cup with smiling face holding pearls, simple black-and-white line-art style, thick outlines, no shading, white background";

type Variant = "threshold-128" | "threshold-160" | "floyd-steinberg";

async function generateImage(prompt: string): Promise<Buffer> {
  console.log(`[doubao] prompt: ${prompt}`);
  const t0 = Date.now();
  const resp = await fetch("https://ark.cn-beijing.volces.com/api/v3/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ARK_API_KEY}`,
    },
    body: JSON.stringify({
      model: "doubao-seedream-4-5-251128",
      prompt,
      sequential_image_generation: "disabled",
      response_format: "url",
      size: "2048x2048",
      stream: false,
      watermark: false,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Doubao API ${resp.status}: ${text}`);
  }
  // Doubao response: { data: [{ url, size, ... }], created, model, usage }
  const json = (await resp.json()) as { data?: Array<{ url?: string }> };
  const url = json.data?.[0]?.url;
  if (!url) throw new Error(`no image url in response: ${JSON.stringify(json).slice(0, 400)}`);
  console.log(`[doubao] generated in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${url}`);

  const imgResp = await fetch(url);
  if (!imgResp.ok) throw new Error(`download failed: ${imgResp.status}`);
  const buf = Buffer.from(await imgResp.arrayBuffer());
  console.log(`[doubao] downloaded ${(buf.length / 1024).toFixed(1)} KB`);
  return buf;
}

function floydSteinberg(gray: Buffer, w: number, h: number): Uint8Array {
  // Diffuse error onto neighbouring pixels using FS coefficients (7/3/5/1 over 16).
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

async function preprocess(
  png: Buffer,
  variant: Variant,
): Promise<{ raw: Buffer; preview: Buffer }> {
  // Resize + slight sharpen to keep edges crisp after downsample, then
  // grayscale → 1-channel raw buffer at DOODLE_SIZE × DOODLE_SIZE.
  const gray = await sharp(png)
    .resize(DOODLE_SIZE, DOODLE_SIZE, { fit: "cover" })
    .sharpen({ sigma: 1 })
    .grayscale()
    .raw()
    .toBuffer();

  let processed: Buffer;
  if (variant === "threshold-128") {
    processed = Buffer.from(gray.map((v) => (v < 128 ? 0 : 255)));
  } else if (variant === "threshold-160") {
    processed = Buffer.from(gray.map((v) => (v < 160 ? 0 : 255)));
  } else {
    processed = Buffer.from(floydSteinberg(gray, DOODLE_SIZE, DOODLE_SIZE));
  }

  const preview = await sharp(processed, {
    raw: { width: DOODLE_SIZE, height: DOODLE_SIZE, channels: 1 },
  })
    .png()
    .toBuffer();

  return { raw: processed, preview };
}

function packTo1Bit(raw: Buffer, w: number, h: number): Buffer {
  // ZPL ^GFA: each row needs `ceil(w/8)` bytes, MSB-first.
  // We treat raw value < 128 as black (set bit) and ≥128 as paper (clear).
  // Our preprocessing already collapses to 0/255 so the threshold is a no-op
  // safety against accidental mid-tone passthrough.
  const bytesPerRow = Math.ceil(w / 8);
  const out = Buffer.alloc(bytesPerRow * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = raw[y * w + x];
      if (v < 128) out[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return out;
}

function escapeZpl(s: string): string {
  // ^ and ~ are command introducers; \ is the field-data escape. The
  // smoke labels are simple ASCII so we just neutralise the special chars.
  return s.replace(/[\^~\\]/g, "_");
}

function buildZpl(args: {
  hex: string;
  totalBytes: number;
  widthBytes: number;
  label: string;
}): string {
  return [
    "^XA",
    `^PW${LABEL_WIDTH_DOTS}`,
    `^LL${LABEL_HEIGHT_DOTS}`,
    "^CI28",
    "^PR4",
    "^LH0,0",
    `^FO0,0^GB${LABEL_WIDTH_DOTS},${TOP_BAND_HEIGHT},${TOP_BAND_HEIGHT}^FS`,
    `^FO20,20^A0N,36,36^FR^FDAI SMOKE^FS`,
    `^FO20,72^A0N,28,28^FR^FD${escapeZpl(args.label)}^FS`,
    `^FO0,${TOP_BAND_HEIGHT}^GFA,${args.totalBytes},${args.totalBytes},${args.widthBytes},${args.hex}^FS`,
    "^XZ",
  ].join("\n");
}

async function main() {
  const aiImg = await generateImage(PROMPT);
  await writeFile("/tmp/ai-raw.png", aiImg);
  console.log(`saved /tmp/ai-raw.png (${(aiImg.length / 1024).toFixed(1)} KB)`);

  // Defer printer import so missing USB libusb in non-print contexts
  // doesn't crash the script during generation.
  const { printCupLabelZPL } = await import(
    "../printer-client/src/cup-label/printer"
  );

  const variants: Variant[] = ["threshold-128", "threshold-160", "floyd-steinberg"];

  for (const variant of variants) {
    console.log(`\n=== ${variant} ===`);
    const { raw, preview } = await preprocess(aiImg, variant);
    const packed = packTo1Bit(raw, DOODLE_SIZE, DOODLE_SIZE);
    const widthBytes = DOODLE_SIZE / 8;
    const zpl = buildZpl({
      hex: packed.toString("hex").toUpperCase(),
      totalBytes: packed.length,
      widthBytes,
      label: variant,
    });

    await writeFile(`/tmp/ai-${variant}.zpl`, zpl);
    await writeFile(`/tmp/ai-${variant}-preview.png`, preview);
    console.log(`saved /tmp/ai-${variant}.{zpl,preview.png}`);

    console.log("printing...");
    await printCupLabelZPL(zpl);
    console.log("printed.");
    // pause for tear-off so labels don't pile up
    await new Promise((r) => setTimeout(r, 4000));
  }

  console.log("\n✔ all variants printed; tear off in order and compare.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
