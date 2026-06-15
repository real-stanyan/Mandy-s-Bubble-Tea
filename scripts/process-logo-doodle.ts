// scripts/process-logo-doodle.ts
//
// Bake the Mandy brand logo (public/logo.webp — mascot + "MANDY'S Bubble
// Tea" wordmark) into the committed, thermal-ready
// `public/cup-label/logo-doodle/binarized.png`.
//
// This is the deterministic cup-art fallback that enqueueCupLabelJobs
// prints whenever a cup has no customer-chosen doodle:
//   * POS (in-store) orders coming in via the Square webhook
//   * web/app checkout cups the customer left untouched
//
// It REPLACES the former random-tarot draw, disabled 2026-06-15 after
// customer religious-objection feedback. The tarot deck + catalog stay
// in the tree (untouched) so the random draw can be re-enabled later.
//
// Pipeline mirrors process-tarot-gallery.ts so the logo prints with the
// same recipe as every other cup sticker:
//   1. Letterbox the (landscape, transparent-bg) logo to
//      DOODLE_SIZE × DOODLE_SIZE with a white pad. `fit: "contain"` keeps
//      the whole wordmark visible; binarize's internal `cover` resize on
//      an already-square buffer is then a no-op.
//   2. Flatten transparency onto white so empty space stays "no print".
//   3. Binarize with Atkinson dither for thermal output.
//
// Run: pnpm tsx scripts/process-logo-doodle.ts

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { binarizeForThermal, DOODLE_SIZE } from "../src/lib/doodle/binarize";

const SRC = join(process.cwd(), "public", "logo.webp");
const OUT_DIR = join(process.cwd(), "public", "cup-label", "logo-doodle");

async function main() {
  const raw = await readFile(SRC);

  const squared = await sharp(raw)
    .resize({
      width: DOODLE_SIZE,
      height: DOODLE_SIZE,
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .png()
    .toBuffer();

  const binarized = await binarizeForThermal(squared, { mode: "atkinson" });

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, "binarized.png"), binarized);

  console.log(
    `[logo-doodle] wrote ${join(OUT_DIR, "binarized.png")} (${binarized.length} bytes, ${DOODLE_SIZE}x${DOODLE_SIZE} atkinson)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
