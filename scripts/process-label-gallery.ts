// scripts/process-label-gallery.ts
//
// Batch-process the source gallery in ~/Desktop/label_images/ through
// the exact same pipeline that /api/cup-label/upload-image runs for
// user uploads:
//
//   * color.png    — sharp resize 1280-max + png(level=9), as in the
//                    `uploads-originals/` branch of upload-image/route.ts.
//                    This is what the gallery picker shows the user.
//   * binarized.png — binarizeForThermal({ mode: "atkinson" }) → 592×592
//                    1-bit PNG, ready for ZPL ^GFA pack. This is what
//                    actually gets sent to ZD410.
//
// Output staging path: <repo>/tmp/label-gallery-staging/<hash>/{color,binarized}.png
// (gitignored — final storage decision pending; eyeball v1 output first.)
//
//   pnpm tsx scripts/process-label-gallery.ts

import { readdir, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import { homedir } from "node:os";
import sharp from "sharp";
import { binarizeForThermal } from "../src/lib/doodle/binarize";

const SRC_DIR = join(homedir(), "Desktop", "label_images");
const OUT_DIR = join(process.cwd(), "tmp", "label-gallery-staging");
const CONCURRENCY = 4;
// Auto-invert detection is currently disabled — Stan handles dark
// backgrounds upstream (in the source image batch). The detection
// helpers below remain in tree as a fallback path; flip
// AUTO_INVERT_ENABLED back to `true` to re-enable.
//
// Two-pass dark-background detection:
//   1. Whole-image mean Rec.709 luma < this → invert. Catches the
//      macOS-screenshot case (dark desktop covers most of the frame).
//   2. Center-crop "true black" pixel ratio > THIS → invert. Catches
//      sticker designs where the dark fill is a centered rectangle
//      surrounded by a white photo border. Uses luma < 30 (not <90)
//      so red foreground (luma ≈ 60–90) doesn't falsely trigger.
const AUTO_INVERT_ENABLED = false;
const MEAN_LUMA_THRESHOLD = 110;
const TRUE_BLACK_LUMA = 30;
const CENTER_BLACK_RATIO_THRESHOLD = 0.3;
const CENTER_CROP = 0.6;

// Manual override lists — auto-detection can't catch every dark-bg
// sticker because some have saturated mid-luma fills (yellow / orange
// / bright blue) covering most of the canvas. Add hashes here as the
// fallback after eyeballing the contact-sheet.
const INVERT_FORCE_HASHES = new Set<string>([
  // e.g. "abcd1234..." — add via /scripts/process-label-gallery.ts override
]);
const INVERT_EXCLUDE_HASHES = new Set<string>([
  // hashes auto-detection wrongly inverts; force back to original.
]);

type Item = { hash: string; src: string };
type Result =
  | {
      ok: true;
      hash: string;
      bytesColor: number;
      bytesBin: number;
      inverted: boolean;
      ms: number;
    }
  | { ok: false; hash: string; error: string };

/** Whole-image mean Rec.709 luma on a 64×64 downscale. */
async function meanLuma(buf: Buffer): Promise<number> {
  const { data } = await sharp(buf)
    .resize(64, 64, { fit: "cover" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  const pixelCount = data.length / 3;
  for (let i = 0; i < data.length; i += 3) {
    sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  }
  return sum / pixelCount;
}

/** Fraction of pixels in a center crop with Rec.709 luma below threshold. */
async function centerBlackRatio(buf: Buffer): Promise<number> {
  const meta = await sharp(buf).metadata();
  if (!meta.width || !meta.height) return 0;
  const cw = Math.floor(meta.width * CENTER_CROP);
  const ch = Math.floor(meta.height * CENTER_CROP);
  const cx = Math.floor((meta.width - cw) / 2);
  const cy = Math.floor((meta.height - ch) / 2);
  const { data } = await sharp(buf)
    .extract({ left: cx, top: cy, width: cw, height: ch })
    .resize(64, 64, { fit: "cover" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let darkCount = 0;
  const pixelCount = data.length / 3;
  for (let i = 0; i < data.length; i += 3) {
    const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    if (l < TRUE_BLACK_LUMA) darkCount++;
  }
  return darkCount / pixelCount;
}

async function shouldInvert(buf: Buffer): Promise<boolean> {
  if ((await meanLuma(buf)) < MEAN_LUMA_THRESHOLD) return true;
  return (await centerBlackRatio(buf)) > CENTER_BLACK_RATIO_THRESHOLD;
}

async function listSources(): Promise<Item[]> {
  const entries = await readdir(SRC_DIR);
  return entries
    .filter((f) => /\.(jpe?g|png)$/i.test(f))
    .map((f) => ({ hash: basename(f, extname(f)), src: join(SRC_DIR, f) }));
}

async function processOne(item: Item): Promise<Result> {
  const t0 = Date.now();
  try {
    const rawOrig = await readFile(item.src);

    // Detect dark-bg stickers via 4-corner luminosity; invert via
    // sharp.negate so background becomes white. Foreground hues shift
    // to their complements as a side-effect of full-image inversion —
    // acceptable for the thermal print path (only luma matters there)
    // and traded off for visual consistency in the picker.
    let inverted: boolean;
    if (INVERT_FORCE_HASHES.has(item.hash)) inverted = true;
    else if (INVERT_EXCLUDE_HASHES.has(item.hash)) inverted = false;
    else if (AUTO_INVERT_ENABLED) inverted = await shouldInvert(rawOrig);
    else inverted = false;
    const raw = inverted
      ? await sharp(rawOrig).negate({ alpha: false }).png().toBuffer()
      : rawOrig;

    const colorPng = await sharp(raw)
      .resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();

    const binarized = await binarizeForThermal(raw, { mode: "atkinson" });

    const outDir = join(OUT_DIR, item.hash);
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, "color.png"), colorPng);
    await writeFile(join(outDir, "binarized.png"), binarized);

    return {
      ok: true,
      hash: item.hash,
      bytesColor: colorPng.length,
      bytesBin: binarized.length,
      inverted,
      ms: Date.now() - t0,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, hash: item.hash, error: msg };
  }
}

async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(n, items.length)).fill(0).map(async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const items = await listSources();
  console.log(`[gallery] ${items.length} source images → ${OUT_DIR}`);

  const results = await pool(items, CONCURRENCY, processOne);

  const ok = results.filter((r): r is Extract<Result, { ok: true }> => r.ok);
  const failed = results.filter((r): r is Extract<Result, { ok: false }> => !r.ok);

  const totalMs = ok.reduce((a, r) => a + r.ms, 0);
  const colorMb = ok.reduce((a, r) => a + r.bytesColor, 0) / 1024 / 1024;
  const binMb = ok.reduce((a, r) => a + r.bytesBin, 0) / 1024 / 1024;
  const invertedCount = ok.filter((r) => r.inverted).length;

  console.log(`[gallery] ok=${ok.length} failed=${failed.length} inverted=${invertedCount}`);
  console.log(
    `[gallery] total: ${colorMb.toFixed(2)} MB color + ${binMb.toFixed(2)} MB binarized; ${totalMs} ms cpu-time`,
  );

  if (failed.length > 0) {
    console.log("[gallery] failures:");
    for (const f of failed) console.log(`  - ${f.hash}: ${f.error}`);
  }

  const manifest = ok.map((r) => ({
    hash: r.hash,
    color: `tmp/label-gallery-staging/${r.hash}/color.png`,
    binarized: `tmp/label-gallery-staging/${r.hash}/binarized.png`,
    inverted: r.inverted,
  }));
  await writeFile(
    join(OUT_DIR, "manifest.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), count: ok.length, items: manifest }, null, 2),
  );
  console.log(`[gallery] manifest → ${join(OUT_DIR, "manifest.json")}`);
}

main().catch((e) => {
  console.error("[gallery] fatal:", e);
  process.exit(1);
});
