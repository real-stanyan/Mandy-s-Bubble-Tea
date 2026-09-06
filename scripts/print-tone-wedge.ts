// scripts/print-tone-wedge.ts
//
// Calibration label for the ZD410: twelve patches of KNOWN nominal dot
// coverage, dithered exactly the way a photo label is dithered, so you can
// read off on real thermal paper where the stock stops showing texture and
// turns into solid black. That number is the ink limit the shadow lift in
// src/lib/doodle/shadow-lift.ts must hold (SHADOW_LIFT.FLOOR = 72 today,
// i.e. the darkest lifted tone prints at ~72% nominal coverage).
//
//   npx tsx scripts/print-tone-wedge.ts            # dry run: writes tmp/tone-wedge-*.png + .zpl
//   npx tsx scripts/print-tone-wedge.ts --print    # queues ONE label on the store printer
//
// Reading the print, left → right the patches are
//
//   100  95  90  85  80  75  70  65  60  50  40  30   % nominal black
//
// separated by thin white gutters. Find the darkest patch that still shows
// an even sprinkle of white dots (not a burn): that coverage is the most ink
// a photo shadow can carry on this stock.
//   * If the first textured patch is LIGHTER than 72% (say 65%), the lift
//     floor is too dark — raise SHADOW_LIFT.FLOOR (≈ 255 × (1 − coverage)).
//   * If 80% still shows clean texture, FLOOR can come down a little to buy
//     back some punch.
//
// --print needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in
// .env.local and the printer-client running; the dry run needs nothing.

import { config as loadEnv } from "dotenv";
import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import Module from "node:module";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { serpentineAtkinson, DOODLE_SIZE } from "../src/lib/doodle/binarize";

// Same server-only stub trick as seed-zd410-test.ts / print-local-binarize.ts.
const M = Module as unknown as {
  _resolveFilename: (req: string, parent: unknown, ...rest: unknown[]) => string;
};
const origResolve = M._resolveFilename;
M._resolveFilename = function (req, parent, ...rest) {
  if (req === "server-only") {
    return path.resolve(__dirname, "./_empty-cjs-stub.cjs");
  }
  return origResolve.call(this, req, parent, ...rest);
};

const {
  renderCupLabel,
} = require("../src/lib/cup-label/render-zebra-cup") as typeof import("../src/lib/cup-label/render-zebra-cup");

loadEnv({ path: path.resolve(__dirname, "../.env.local") });

const COVERAGES = [100, 95, 90, 85, 80, 75, 70, 65, 60, 50, 40, 30];
const GUTTER = 2; // white dots between patches
const MARGIN_Y = 24; // white rows top and bottom

function buildWedgeGray(): Uint8Array {
  const S = DOODLE_SIZE;
  const gray = new Uint8Array(S * S).fill(255);
  const patchW = Math.floor((S - GUTTER * (COVERAGES.length - 1)) / COVERAGES.length);
  for (let k = 0; k < COVERAGES.length; k++) {
    const level = Math.round(255 * (1 - COVERAGES[k] / 100));
    const x0 = k * (patchW + GUTTER);
    for (let y = MARGIN_Y; y < S - MARGIN_Y; y++) {
      for (let x = x0; x < x0 + patchW; x++) gray[y * S + x] = level;
    }
  }
  return gray;
}

async function main() {
  const print = process.argv.includes("--print");
  const S = DOODLE_SIZE;
  const dithered = serpentineAtkinson(buildWedgeGray(), S, S);
  const rasterPng = await sharp(Buffer.from(dithered), { raw: { width: S, height: S, channels: 1 } })
    .png()
    .toBuffer();

  const sequence = COVERAGES.join(" ");
  // The bottom band wraps on "\n" at 26 chars per line — split the sequence
  // so every patch value makes it onto the label.
  const legend = [
    "L to R, % nominal black:",
    COVERAGES.slice(0, 6).join(" "),
    COVERAGES.slice(6).join(" "),
  ].join("\n");
  const { zpl, previewPng } = await renderCupLabel({
    stickerNumber: "WEDGE",
    cupIdxOf: { idx: 1, total: 1 },
    drinkName: "Tone wedge",
    modifiersText: legend,
    doodleSvg: "",
    doodlePngBuffer: rasterPng,
  });

  const outDir = path.resolve(__dirname, "../tmp");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "tone-wedge-raster.png"), rasterPng);
  writeFileSync(path.join(outDir, "tone-wedge-label.png"), previewPng);
  writeFileSync(path.join(outDir, "tone-wedge.zpl"), zpl);
  console.log(`[tone-wedge] patches L->R: ${sequence} % nominal black`);
  console.log(`[tone-wedge] wrote ${outDir}/tone-wedge-raster.png, tone-wedge-label.png, tone-wedge.zpl`);

  if (!print) {
    console.log("[tone-wedge] dry run — add --print to queue the label on the store printer");
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required in .env.local for --print");
  }
  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await sb
    .from("cup_label_jobs")
    .insert({
      square_order_id: `tone-wedge-${Date.now()}`,
      line_id: "calibration",
      cup_idx: 0,
      sticker_number: "WEDGE",
      drink_name: "Tone wedge",
      modifiers_text: legend,
      doodle_source: "ai",
      doodle_pool_key: null,
      zpl_body: zpl,
      target_printer_kind: "zd410",
    })
    .select("id")
    .single();
  if (error) throw new Error(`insert failed: ${error.message}`);
  console.log(`[tone-wedge] queued job id=${data.id} (zpl ${zpl.length} bytes) — printer-client should fire shortly`);
}

main().catch((err) => {
  console.error("[tone-wedge] failed:", err);
  process.exit(1);
});
