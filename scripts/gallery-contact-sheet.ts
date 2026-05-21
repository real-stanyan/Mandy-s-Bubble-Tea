// scripts/gallery-contact-sheet.ts
//
// Assemble a single contact-sheet PNG of every gallery item, with
// color thumbnail and binarized output side-by-side, so the whole
// batch can be eyeballed in one view.
//
//   pnpm tsx scripts/gallery-contact-sheet.ts
//
// Output: tmp/label-gallery-staging/_contact-sheet.png

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const STAGING_DIR = join(process.cwd(), "tmp", "label-gallery-staging");
const OUT_FILE = join(STAGING_DIR, "_contact-sheet.png");

const CELL_W = 200;
const CELL_H = 200;
const GAP = 4;
const COLS = 8; // 8 cells per row × 2 panes = 16 panes; total 80 cells fits 78 items + 2 blank

async function main() {
  const entries = await readdir(STAGING_DIR, { withFileTypes: true });
  const hashes = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  console.log(`[contact] ${hashes.length} items`);

  const rows = Math.ceil(hashes.length / COLS);
  const cellPairW = CELL_W * 2 + GAP; // color + binarized
  const totalW = COLS * cellPairW + (COLS + 1) * GAP;
  const totalH = rows * CELL_H + (rows + 1) * GAP;

  const sheet = sharp({
    create: {
      width: totalW,
      height: totalH,
      channels: 3,
      background: { r: 245, g: 230, b: 200 }, // brand cream
    },
  });

  const composites: sharp.OverlayOptions[] = [];

  for (let i = 0; i < hashes.length; i++) {
    const hash = hashes[i];
    const col = i % COLS;
    const row = Math.floor(i / COLS);

    const x0 = GAP + col * (cellPairW + GAP);
    const y0 = GAP + row * (CELL_H + GAP);

    const colorBuf = await readFile(join(STAGING_DIR, hash, "color.png"));
    const binBuf = await readFile(join(STAGING_DIR, hash, "binarized.png"));

    const colorThumb = await sharp(colorBuf)
      .resize(CELL_W, CELL_H, { fit: "contain", background: { r: 255, g: 255, b: 255 } })
      .png()
      .toBuffer();
    const binThumb = await sharp(binBuf)
      .resize(CELL_W, CELL_H, { fit: "contain", background: { r: 255, g: 255, b: 255 } })
      .png()
      .toBuffer();

    // Index label in the top-left corner of the cell, drawn as an SVG
    // overlay so Stan can call out cells by number from the contact sheet.
    const idxLabel = await sharp(
      Buffer.from(
        `<svg width="70" height="32" xmlns="http://www.w3.org/2000/svg">
          <rect x="0" y="0" width="70" height="32" fill="red" fill-opacity="0.85"/>
          <text x="6" y="24" font-family="-apple-system,Helvetica,Arial" font-size="22" font-weight="800" fill="white">#${i}</text>
        </svg>`,
      ),
    )
      .png()
      .toBuffer();

    composites.push({ input: colorThumb, left: x0, top: y0 });
    composites.push({ input: binThumb, left: x0 + CELL_W + GAP, top: y0 });
    composites.push({ input: idxLabel, left: x0 + 2, top: y0 + 2 });
  }

  await sheet.composite(composites).png({ compressionLevel: 9 }).toFile(OUT_FILE);
  console.log(`[contact] → ${OUT_FILE} (${totalW}×${totalH})`);
}

main().catch((e) => {
  console.error("[contact] fatal:", e);
  process.exit(1);
});
