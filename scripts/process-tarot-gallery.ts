// scripts/process-tarot-gallery.ts
//
// Batch-process the tarot card source set in ~/Desktop/塔罗牌/ into the
// committed `public/cup-label/tarot/<hash>/binarized.png` tree. Used by
// the POS path + web-default fallback in enqueueCupLabelJobs to draw a
// random card per cup when the customer hasn't picked a label.
//
// Pipeline (per source image):
//   1. Letterbox the JPG to DOODLE_SIZE × DOODLE_SIZE with a white pad
//      (portrait card → white strips left + right). `fit: "contain"`
//      means the whole card stays visible before binarize's internal
//      `cover` becomes a no-op.
//   2. Composite a text overlay onto the white strips — card name on
//      the left strip (vertical, rotated -90), upright meaning on the
//      right strip (vertical, rotated -90, wrapped to multi-column).
//      Name + meaning come from `src/lib/cup-label/tarot-catalog.ts`
//      keyed by md5 hash. Hashes with no catalog entry skip the overlay
//      and bake as image-only (forward-compat for future additions).
//   3. Binarize with Atkinson dither for thermal output.
//
// Run: pnpm tsx scripts/process-tarot-gallery.ts

import { readdir, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, basename, extname, resolve } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { Resvg } from "@resvg/resvg-js";
import { binarizeForThermal, DOODLE_SIZE } from "../src/lib/doodle/binarize";
import { getTarotMetadata } from "../src/lib/cup-label/tarot-catalog";

// Covered By Your Grace (handwritten) for the card-name strip,
// Akt (sans-serif) for the meaning strip. Both fonts registered
// explicitly so Resvg resolves them on Mac dev + Linux/Vercel
// identically (Resvg doesn't read system fonts by family-name in a
// portable way). OFL licenses sit beside each TTF.
const FONT_DIR = resolve(
  __dirname,
  "..",
  "src",
  "lib",
  "cup-label",
  "fonts",
);
const COVERED_FONT_PATH = resolve(FONT_DIR, "CoveredByYourGrace-Regular.ttf");
const AKT_FONT_PATH = resolve(FONT_DIR, "Akt-Regular.ttf");

const SRC_DIR = join(homedir(), "Desktop", "塔罗牌");
const OUT_DIR = join(process.cwd(), "public", "cup-label", "tarot");
const CONCURRENCY = 4;

type Item = { srcPath: string; srcName: string };
type Result =
  | { ok: true; hash: string; bytes: number; ms: number; overlaid: boolean }
  | { ok: false; srcName: string; error: string };

async function listSources(): Promise<Item[]> {
  const entries = await readdir(SRC_DIR);
  return entries
    .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
    .map((f) => ({ srcName: basename(f, extname(f)), srcPath: join(SRC_DIR, f) }));
}

// ---- Text overlay ----

function escapeXml(s: string): string {
  return s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
}

function wrapWords(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur.length === 0) cur = w;
    else if (cur.length + 1 + w.length <= maxChars) cur = `${cur} ${w}`;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Render a transparent PNG the size of the doodle band with vertical
// text strips. Composited onto the letterboxed card BEFORE binarize so
// the text passes through the same 1-bit Atkinson dither as the artwork.
//
//   * Left strip  (card name)  — 42pt 900-weight, rotated -90 (CCW)
//   * Right strip (meaning)    — 28pt 600-weight, rotated -90, wrap
//                                multi-column (each line is a sibling
//                                <text> drawn vertically-stacked
//                                pre-rotation; after the surrounding
//                                <g> rotates, lines land side-by-side
//                                in natural reading order).
//
// Strip width derives from the source aspect ratio so the text always
// centers within whatever white pad the letterbox produced.
async function buildOverlayPng(
  srcWidth: number,
  srcHeight: number,
  cardName: string,
  meaning: string,
): Promise<Buffer> {
  const scale = Math.min(DOODLE_SIZE / srcWidth, DOODLE_SIZE / srcHeight);
  const cardW = Math.round(srcWidth * scale);
  const stripW = Math.max(0, Math.floor((DOODLE_SIZE - cardW) / 2));

  const nameFontSize = 42;
  const meaningFontSize = 28;
  const meaningLineSpacing = 34;
  const meaningMaxChars = 28;
  const nameX = Math.round(stripW / 2);
  const meaningX = DOODLE_SIZE - Math.round(stripW / 2);
  const midY = Math.round(DOODLE_SIZE / 2);

  const meaningLines = wrapWords(meaning, meaningMaxChars);
  const meaningElems = meaningLines
    .map((line, i) => {
      const yOffset = (i - (meaningLines.length - 1) / 2) * meaningLineSpacing;
      const lineY = midY + yOffset;
      return `<text x="${meaningX}" y="${lineY}" text-anchor="middle" dominant-baseline="central"
              font-family="Akt" font-size="${meaningFontSize}" font-weight="500"
              letter-spacing="1" fill="black">${escapeXml(line)}</text>`;
    })
    .join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${DOODLE_SIZE}" height="${DOODLE_SIZE}">
    <g transform="rotate(-90 ${nameX} ${midY})">
      <text x="${nameX}" y="${midY}" text-anchor="middle" dominant-baseline="central"
            font-family="Covered By Your Grace" font-size="${nameFontSize}"
            letter-spacing="2" fill="black">${escapeXml(cardName)}</text>
    </g>
    <g transform="rotate(-90 ${meaningX} ${midY})">
      ${meaningElems}
    </g>
  </svg>`;

  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: DOODLE_SIZE },
    background: "rgba(0,0,0,0)",
    font: {
      fontFiles: [COVERED_FONT_PATH, AKT_FONT_PATH],
      loadSystemFonts: true,
      defaultFontFamily: "Akt",
    },
  });
  return Buffer.from(resvg.render().asPng());
}

async function processOne(item: Item): Promise<Result> {
  const t0 = Date.now();
  try {
    const raw = await readFile(item.srcPath);
    const hash = createHash("md5").update(raw).digest("hex");

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

    const meta = getTarotMetadata(hash);
    let overlaid = squared;
    let overlaidFlag = false;
    if (meta) {
      const srcMeta = await sharp(raw).metadata();
      const overlay = await buildOverlayPng(
        srcMeta.width ?? DOODLE_SIZE,
        srcMeta.height ?? DOODLE_SIZE,
        meta.name,
        meta.meaning,
      );
      overlaid = await sharp(squared)
        .composite([{ input: overlay, top: 0, left: 0 }])
        .png()
        .toBuffer();
      overlaidFlag = true;
    }

    const binarized = await binarizeForThermal(overlaid, { mode: "atkinson" });

    const outDir = join(OUT_DIR, hash);
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, "binarized.png"), binarized);

    return { ok: true, hash, bytes: binarized.length, ms: Date.now() - t0, overlaid: overlaidFlag };
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
  const hashSet = new Set(ok.map((r) => r.hash));
  const overlaidCount = ok.filter((r) => r.overlaid).length;
  const skippedOverlay = ok.filter((r) => !r.overlaid).length;

  const totalMs = ok.reduce((a, r) => a + r.ms, 0);
  const binMb = ok.reduce((a, r) => a + r.bytes, 0) / 1024 / 1024;

  console.log(
    `[tarot] ok=${ok.length} unique=${hashSet.size} overlaid=${overlaidCount} no_catalog=${skippedOverlay} failed=${failed.length} | ${binMb.toFixed(2)} MB | ${totalMs} ms cpu-time`,
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
