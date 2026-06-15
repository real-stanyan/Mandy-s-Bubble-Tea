// scripts/append-label-gallery.ts
//
// APPEND a small batch of new label images into the existing staging dir
// (tmp/label-gallery-staging/<hash>/{color,binarized}.png) WITHOUT touching
// the 225 already-staged hashes. Mirrors the exact pipeline of
// process-label-gallery.ts, except:
//
//   * source dir is passed as argv[2] (one-off batch folder), and
//   * hash = md5(file content), 32-hex content-address — the new batch's
//     filenames are not clean md5s, and content-addressing also dedups any
//     image that already exists in the gallery.
//
// After this, run scripts/deploy-gallery.ts to rebuild public/ from staging.
//
//   pnpm tsx scripts/append-label-gallery.ts "/Users/stanyan/Desktop/新建文件夹"

import { readdir, mkdir, readFile, writeFile, access } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { binarizeForThermal } from "../src/lib/doodle/binarize";

const SRC_DIR = process.argv[2];
const OUT_DIR = join(process.cwd(), "tmp", "label-gallery-staging");
const CONCURRENCY = 4;

type Item = { hash: string; src: string; file: string };
type Result =
  | { ok: true; hash: string; file: string; bytesColor: number; bytesBin: number; skipped: boolean; ms: number }
  | { ok: false; hash: string; file: string; error: string };

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function listSources(): Promise<Item[]> {
  const entries = await readdir(SRC_DIR);
  const items: Item[] = [];
  for (const f of entries) {
    if (!/\.(jpe?g|png)$/i.test(f)) continue;
    const src = join(SRC_DIR, f);
    const buf = await readFile(src);
    const hash = createHash("md5").update(buf).digest("hex");
    items.push({ hash, src, file: f });
  }
  return items;
}

async function processOne(item: Item): Promise<Result> {
  const t0 = Date.now();
  try {
    const outDir = join(OUT_DIR, item.hash);
    // Idempotent: if both outputs already exist, skip (already in gallery).
    if ((await exists(join(outDir, "color.png"))) && (await exists(join(outDir, "binarized.png")))) {
      return { ok: true, hash: item.hash, file: item.file, bytesColor: 0, bytesBin: 0, skipped: true, ms: 0 };
    }

    const raw = await readFile(item.src);
    // AUTO_INVERT disabled, matching process-label-gallery.ts — Stan handles
    // dark backgrounds upstream in the source batch.
    const colorPng = await sharp(raw)
      .resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();

    const binarized = await binarizeForThermal(raw, { mode: "atkinson" });

    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, "color.png"), colorPng);
    await writeFile(join(outDir, "binarized.png"), binarized);

    return {
      ok: true,
      hash: item.hash,
      file: item.file,
      bytesColor: colorPng.length,
      bytesBin: binarized.length,
      skipped: false,
      ms: Date.now() - t0,
    };
  } catch (e) {
    return { ok: false, hash: item.hash, file: item.file, error: e instanceof Error ? e.message : String(e) };
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
  if (!SRC_DIR) {
    console.error("usage: pnpm tsx scripts/append-label-gallery.ts <source-dir>");
    process.exit(1);
  }
  await mkdir(OUT_DIR, { recursive: true });
  const items = await listSources();
  console.log(`[append] ${items.length} source images from ${SRC_DIR} → ${OUT_DIR}`);

  const results = await pool(items, CONCURRENCY, processOne);
  const ok = results.filter((r): r is Extract<Result, { ok: true }> => r.ok);
  const failed = results.filter((r): r is Extract<Result, { ok: false }> => !r.ok);
  const added = ok.filter((r) => !r.skipped);
  const skipped = ok.filter((r) => r.skipped);

  console.log(`[append] added=${added.length} skipped(dup)=${skipped.length} failed=${failed.length}`);
  for (const r of added) console.log(`  + ${r.hash}  (${r.file})`);
  for (const r of skipped) console.log(`  = ${r.hash}  (${r.file}) already in gallery`);
  for (const f of failed) console.log(`  ! ${f.file}: ${f.error}`);

  if (failed.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error("[append] fatal:", e);
  process.exit(1);
});
