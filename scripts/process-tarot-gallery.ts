// scripts/process-tarot-gallery.ts
//
// Batch-process the tarot card source set in ~/Desktop/塔罗牌/ into the
// committed `public/cup-label/tarot/<hash>/binarized.png` tree. Used by
// the POS path + web-default fallback in enqueueCupLabelJobs to draw a
// random card per cup when the customer hasn't picked a label.
//
// Unlike the user-gallery pipeline (which `fit: "cover"` crops to a
// square so a portrait photo becomes a centered headshot), tarot cards
// must show the WHOLE card — top to bottom — so we letterbox to square
// with a white background (`fit: "contain" + extend white`) BEFORE the
// 592×592 cover-crop in binarizeForThermal becomes a no-op.
//
// Run: pnpm tsx scripts/process-tarot-gallery.ts

import { readdir, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { binarizeForThermal, DOODLE_SIZE } from "../src/lib/doodle/binarize";

const SRC_DIR = join(homedir(), "Desktop", "塔罗牌");
const OUT_DIR = join(process.cwd(), "public", "cup-label", "tarot");
const CONCURRENCY = 4;

type Item = { srcPath: string; srcName: string };
type Result =
  | { ok: true; hash: string; bytes: number; ms: number }
  | { ok: false; srcName: string; error: string };

async function listSources(): Promise<Item[]> {
  const entries = await readdir(SRC_DIR);
  return entries
    .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
    .map((f) => ({ srcName: basename(f, extname(f)), srcPath: join(SRC_DIR, f) }));
}

async function processOne(item: Item): Promise<Result> {
  const t0 = Date.now();
  try {
    const raw = await readFile(item.srcPath);
    const hash = createHash("md5").update(raw).digest("hex");

    // Letterbox-to-square with white padding so the whole card stays
    // visible after binarize's internal cover-crop. Output square edge
    // matches DOODLE_SIZE so the cover-crop is a no-op identity.
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

    const outDir = join(OUT_DIR, hash);
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, "binarized.png"), binarized);

    return { ok: true, hash, bytes: binarized.length, ms: Date.now() - t0 };
  } catch (e) {
    return {
      ok: false,
      srcName: item.srcName,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(n, items.length)).fill(0).map(async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const items = await listSources();
  console.log(`[tarot] ${items.length} source images → ${OUT_DIR}`);

  const results = await pool(items, CONCURRENCY, processOne);

  const ok = results.filter((r): r is Extract<Result, { ok: true }> => r.ok);
  const failed = results.filter((r): r is Extract<Result, { ok: false }> => !r.ok);

  // De-dupe by hash (two source files with identical bytes would collide,
  // which is fine — same output dir, just printed once).
  const hashSet = new Set(ok.map((r) => r.hash));

  const totalMs = ok.reduce((a, r) => a + r.ms, 0);
  const binMb = ok.reduce((a, r) => a + r.bytes, 0) / 1024 / 1024;

  console.log(
    `[tarot] ok=${ok.length} unique=${hashSet.size} failed=${failed.length} | ${binMb.toFixed(2)} MB binarized | ${totalMs} ms cpu-time`,
  );

  if (failed.length > 0) {
    console.log("[tarot] failures:");
    for (const f of failed) console.log(`  - ${f.srcName}: ${f.error}`);
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    count: hashSet.size,
    hashes: Array.from(hashSet).sort(),
  };
  await writeFile(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`[tarot] manifest → ${join(OUT_DIR, "manifest.json")}`);
}

main().catch((e) => {
  console.error("[tarot] fatal:", e);
  process.exit(1);
});
