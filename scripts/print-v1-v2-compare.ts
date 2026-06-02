// scripts/print-v1-v2-compare.ts
//
// Queues TWO real cup-label jobs to the running printer-client so we
// can hold v1 and v2 side-by-side on real thermal paper. Both labels
// use the same Doubao source image; only the binarize pipeline differs.
//
// Each label is tagged in modifiersText so you can tell which is which
// after they come out of the printer.
//
//   npx tsx scripts/print-v1-v2-compare.ts
//
// Default uses the same prod Doubao AI original used by the visual
// compare script (the North Face photo). Override with --path <storage_path>.
//
// Requires:
//   * printer-client running and pointed at ZD410
//   * NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local

import { config as loadEnv } from "dotenv";
import path from "node:path";
import Module from "node:module";
import { createClient } from "@supabase/supabase-js";
import { binarizeForThermalV1 } from "../src/lib/doodle/binarize.v1";
import { binarizeForThermal } from "../src/lib/doodle/binarize";

// Same server-only stub trick as seed-zd410-test.ts.
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

const DEFAULT_PATH =
  "ca94135c-14de-4cfb-a410-0a7d970dedc0/ai-originals/a5fc57d7-0a45-4e2b-8b4e-172552507e11.png";

function arg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? (process.argv[idx + 1] ?? fallback) : fallback;
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required in .env.local");
  }
  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const sourcePath = arg("path", DEFAULT_PATH);
  console.log(`[print-compare] loading source from doodles_pending/${sourcePath}`);
  const dl = await sb.storage.from("doodles_pending").download(sourcePath);
  if (dl.error || !dl.data) throw new Error(`download failed: ${dl.error?.message}`);
  const raw = Buffer.from(await dl.data.arrayBuffer());

  const labels: Array<{ label: string; png: Buffer }> = [
    { label: "v1", png: await binarizeForThermalV1(raw, { mode: "atkinson" }) },
    { label: "v2", png: await binarizeForThermal(raw, { mode: "atkinson" }) },
  ];

  for (const { label, png } of labels) {
    const stickerNumber = `CMP${label.toUpperCase()}`;
    const { zpl } = await renderCupLabel({
      stickerNumber,
      cupIdxOf: { idx: 1, total: 1 },
      drinkName: `Pipeline ${label.toUpperCase()}`,
      modifiersText: `Binarize ${label} compare`,
      doodleSvg: "",
      doodlePngBuffer: png,
    });

    const orderId = `binarize-compare-${Date.now()}-${label}`;
    const lineId = "compare";
    const cupIdx = 0;

    const { data, error: insErr } = await sb
      .from("cup_label_jobs")
      .insert({
        square_order_id: orderId,
        line_id: lineId,
        cup_idx: cupIdx,
        sticker_number: stickerNumber,
        drink_name: `Pipeline ${label.toUpperCase()}`,
        modifiers_text: `Binarize ${label} compare`,
        doodle_source: "ai",
        doodle_pool_key: null,
        zpl_body: zpl,
        target_printer_kind: "zd410",
      })
      .select("id")
      .single();
    if (insErr) throw new Error(`insert ${label} failed: ${insErr.message}`);
    console.log(`[print-compare] queued ${label} → cup_label_jobs id=${data.id} (zpl ${zpl.length} bytes)`);
  }

  console.log("\nprinter-client should print v1 then v2 within a few seconds.");
  console.log("Both labels are tagged in modifiers/drink line so you can tell them apart.");
}

main().catch((err) => {
  console.error("[print-compare] failed:", err);
  process.exit(1);
});
