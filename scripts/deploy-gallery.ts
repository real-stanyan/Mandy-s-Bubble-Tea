// scripts/deploy-gallery.ts
//
// Promote tmp/label-gallery-staging/<hash>/{color,binarized}.png to
// public/cup-label/gallery/<hash>/{color,binarized}.png, with color
// downscaled to 480px (picker thumbnail size — the 1280-max staging
// version is too heavy to ship 78× to the browser). Binarized PNG
// stays at 592×592 1-bit (printable size).
//
// Also writes public/cup-label/gallery/manifest.json: { hashes: [...] }.
//
//   pnpm tsx scripts/deploy-gallery.ts

import { readdir, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const SRC = join(process.cwd(), "tmp", "label-gallery-staging");
const DEST = join(process.cwd(), "public", "cup-label", "gallery");
const THUMB_SIZE = 480;

async function main() {
  const entries = await readdir(SRC, { withFileTypes: true });
  const hashes = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  console.log(`[deploy] ${hashes.length} → ${DEST}`);

  await rm(DEST, { recursive: true, force: true });
  await mkdir(DEST, { recursive: true });

  let totalColor = 0;
  let totalBin = 0;

  for (const hash of hashes) {
    const outDir = join(DEST, hash);
    await mkdir(outDir, { recursive: true });

    const colorBuf = await readFile(join(SRC, hash, "color.png"));
    const thumb = await sharp(colorBuf)
      .resize({ width: THUMB_SIZE, height: THUMB_SIZE, fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
    await writeFile(join(outDir, "color.png"), thumb);
    totalColor += thumb.length;

    const binBuf = await readFile(join(SRC, hash, "binarized.png"));
    await writeFile(join(outDir, "binarized.png"), binBuf);
    totalBin += binBuf.length;
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    count: hashes.length,
    hashes,
  };
  await writeFile(join(DEST, "manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(
    `[deploy] color ${(totalColor / 1024 / 1024).toFixed(2)} MB + bin ${(totalBin / 1024 / 1024).toFixed(2)} MB`,
  );
  console.log(`[deploy] manifest → public/cup-label/gallery/manifest.json`);
}

main().catch((e) => {
  console.error("[deploy] fatal:", e);
  process.exit(1);
});
