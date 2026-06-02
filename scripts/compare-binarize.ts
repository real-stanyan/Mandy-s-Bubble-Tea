// scripts/compare-binarize.ts
//
// Side-by-side v1-vs-v2 binarize comparison for eyeball review on
// real photos. Pulls one real Doubao AI original from prod Storage,
// runs both pipelines on it + the bundled sample-photo fixture, and
// writes a single composite PNG per source to /tmp/binarize-compare/.
//
// Layout per source: [v1 output | v2 output] horizontally, both at
// DOODLE_SIZE (592 px). Open the resulting PNG in Preview and flip
// fullscreen to compare dither texture.
//
//   pnpm tsx scripts/compare-binarize.ts

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { binarizeForThermal, DOODLE_SIZE } from "../src/lib/doodle/binarize";
import { binarizeForThermalV1 } from "../src/lib/doodle/binarize.v1";

const OUT_DIR = "/tmp/binarize-compare";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

type Source = { name: string; buf: Buffer };

async function loadFromStorage(path: string): Promise<Buffer> {
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data, error } = await sb.storage.from("doodles_pending").download(path);
  if (error || !data) throw new Error(`download ${path}: ${error?.message}`);
  return Buffer.from(await data.arrayBuffer());
}

async function compose(v1: Buffer, v2: Buffer): Promise<Buffer> {
  return sharp({
    create: {
      width: DOODLE_SIZE * 2 + 20,
      height: DOODLE_SIZE,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  })
    .composite([
      { input: v1, left: 0, top: 0 },
      { input: v2, left: DOODLE_SIZE + 20, top: 0 },
    ])
    .png()
    .toBuffer();
}

async function run() {
  await mkdir(OUT_DIR, { recursive: true });
  const sources: Source[] = [];

  // Fixture photo bundled in repo.
  try {
    sources.push({
      name: "sample-photo",
      buf: readFileSync("src/lib/__fixtures__/sample-photo.jpg"),
    });
  } catch (e) {
    console.warn("sample-photo.jpg missing, skipping");
  }

  // Real Doubao AI original from prod (most recent ready row with original_png_path).
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const prodPath =
        "ca94135c-14de-4cfb-a410-0a7d970dedc0/ai-originals/a5fc57d7-0a45-4e2b-8b4e-172552507e11.png";
      sources.push({
        name: "prod-doubao-ai",
        buf: await loadFromStorage(prodPath),
      });
    } catch (e) {
      console.warn(`prod sample skipped: ${e instanceof Error ? e.message : e}`);
    }
  }

  for (const src of sources) {
    console.log(`processing ${src.name} (${src.buf.length} bytes)`);
    const t0 = Date.now();
    const v1Png = await binarizeForThermalV1(src.buf, { mode: "atkinson" });
    const t1 = Date.now();
    const v2Png = await binarizeForThermal(src.buf, { mode: "atkinson" });
    const t2 = Date.now();
    const composite = await compose(v1Png, v2Png);
    const out = join(OUT_DIR, `${src.name}-v1-vs-v2.png`);
    await writeFile(out, composite);
    console.log(`  v1 ${t1 - t0}ms  v2 ${t2 - t1}ms  →  ${out}`);

    // Also dump pure v2 + pure v1 separately so Stan can fullscreen
    // them one at a time without the side-by-side compositing.
    await writeFile(join(OUT_DIR, `${src.name}-v1.png`), v1Png);
    await writeFile(join(OUT_DIR, `${src.name}-v2.png`), v2Png);
  }

  console.log(`\nopen ${OUT_DIR}/*.png to review`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
