// scripts/process-lucky-cat-gallery.ts
//
// Batch-process the 招财猫 (lucky cat) source set in ~/Desktop/招财猫/ into
// the committed `public/cup-label/lucky-cat/<md5>/binarized.png` tree.
// Used by enqueueCupLabelJobs as the random cup-art fallback for POS
// orders + web cups the customer didn't customize (replaces the random
// tarot / fixed Mandy-logo fallback).
//
// These are hand-drawn cat illustrations on SATURATED colored backgrounds
// (red / etc). A normal grayscale→dither would turn the colored bg into a
// noisy gray (atkinson) or a solid black slab (threshold) — both terrible
// on thermal paper. So we knock the background out first:
//
//   Pipeline (per source image):
//     1. Letterbox to DOODLE_SIZE × DOODLE_SIZE on white (fit: contain),
//        flatten transparency to white.
//     2. VALUE-CHANNEL knockout — rebuild the image as grayscale where
//        each pixel = max(R,G,B) (HSV "Value"). Saturated bg colors
//        (red ~220, gold ~230) read HIGH → white; black ink outlines
//        read LOW → black; the white cat body stays white. Net result is
//        clean black line-art on white, color fills dropped.
//     3. binarizeForThermal({ mode: "threshold" }) — the value channel is
//        already near-1-bit, so a hard threshold keeps lines crisp
//        without dither speckle. (atkinson would re-introduce gray.)
//
// Hashing: source filenames are non-standard (31-char, not md5(bytes)),
// so the output dir is the md5 of the file CONTENT — content-addressed and
// dedup-safe (mirrors scripts/append-label-gallery.ts).
//
// Run: pnpm tsx scripts/process-lucky-cat-gallery.ts

import { readdir, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { binarizeForThermal, DOODLE_SIZE } from "../src/lib/doodle/binarize";
import { RARE_LUCKY_CAT_HASH } from "../src/lib/cup-label/lucky-cat";

const SRC_DIR = join(homedir(), "Desktop", "招财猫");
const OUT_DIR = join(process.cwd(), "public", "cup-label", "lucky-cat");
const THRESHOLD = 200; // value-channel: anything not near-white → black ink

// Some sources are full-COLOR cartoon cats (colored bodies + bold black
// outlines) rather than white line-art on a saturated bg. The value-channel
// knockout floods their colored fills to black. For those, route through
// ink-line extraction instead: keep only near-black ink (the outlines),
// drop everything mid-tone → a clean coloring-book line drawing. Opt in by
// naming the source file with the `inkline-` prefix.
const INK_LINE_PREFIX = "inkline-";
const INK_LINE_THRESHOLD = 70; // luminance < 70 → black ink; tuned across the set

// Rebuild as a grayscale-RGB buffer where each pixel = max(R,G,B). This
// drops saturated background color to white while keeping dark outlines.
async function valueChannelPng(src: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(src)
    .resize({
      width: DOODLE_SIZE,
      height: DOODLE_SIZE,
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const px = info.width * info.height;
  const out = Buffer.alloc(px * 3);
  for (let i = 0; i < px; i++) {
    const v = Math.max(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]);
    out[i * 3] = v;
    out[i * 3 + 1] = v;
    out[i * 3 + 2] = v;
  }
  return sharp(out, {
    raw: { width: info.width, height: info.height, channels: 3 },
  })
    .png()
    .toBuffer();
}

// Ink-line extraction for full-color cartoon cats: grayscale → mild blur to
// tame jpeg noise → hard threshold keeping only near-black ink → median
// despeckle. Produces a clean 1-bit line drawing; colored fills drop to white.
async function inkLineBinarized(src: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(src)
    .resize({
      width: DOODLE_SIZE,
      height: DOODLE_SIZE,
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .removeAlpha()
    .grayscale()
    .blur(0.6)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height);
  for (let i = 0; i < out.length; i++) out[i] = data[i] < INK_LINE_THRESHOLD ? 0 : 255;
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 1 } })
    .median(3)
    .png()
    .toBuffer();
}

async function main() {
  const entries = await readdir(SRC_DIR);
  const sources = entries.filter((f) => /\.(jpe?g|png|webp)$/i.test(f));

  let ok = 0;
  let rareSeen = false;
  for (const name of sources) {
    const raw = await readFile(join(SRC_DIR, name));
    const hash = createHash("md5").update(raw).digest("hex");
    const useInkLine = name.startsWith(INK_LINE_PREFIX);
    const binarized = useInkLine
      ? await inkLineBinarized(raw)
      : await binarizeForThermal(await valueChannelPng(raw), {
          mode: "threshold",
          threshold: THRESHOLD,
        });
    const outDir = join(OUT_DIR, hash);
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, "binarized.png"), binarized);
    ok++;
    const isRare = hash === RARE_LUCKY_CAT_HASH;
    if (isRare) rareSeen = true;
    console.log(`  ${isRare ? "★RARE" : useInkLine ? "ink  " : "     "} ${name} → ${hash} (${binarized.length}b)`);
  }

  console.log(
    `[lucky-cat] wrote ${ok}/${sources.length} cats to ${OUT_DIR}` +
      (rareSeen
        ? `\n[lucky-cat] jackpot cat present: ${RARE_LUCKY_CAT_HASH} ✓`
        : `\n[lucky-cat] ⚠️ jackpot cat ${RARE_LUCKY_CAT_HASH} NOT found among sources!`),
  );
  if (!rareSeen) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
