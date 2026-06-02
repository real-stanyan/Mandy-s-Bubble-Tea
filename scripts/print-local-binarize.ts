// scripts/print-local-binarize.ts
//
// Same as print-v1-v2-compare.ts but takes one or more local image
// files (jpg/png) and prints both v1 and v2 of each on ZD410.
//
//   npx tsx scripts/print-local-binarize.ts <path1> [<path2> ...]
//
// Each label is tagged "<basename>-V1" / "<basename>-V2" in the
// sticker_number and drink_name fields so prints come out paired.

import { config as loadEnv } from "dotenv";
import path from "node:path";
import { readFileSync } from "node:fs";
import Module from "node:module";
import { createClient } from "@supabase/supabase-js";
import { binarizeForThermalV1 } from "../src/lib/doodle/binarize.v1";
import { binarizeForThermal } from "../src/lib/doodle/binarize";

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

function shortTag(fullPath: string): string {
  // Pull a 4-char-ish unique tag from the basename so the printed
  // label says e.g. "NOODL-V1" instead of the full hash.
  const base = path.basename(fullPath, path.extname(fullPath));
  const alnum = base.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return alnum.slice(0, 5) || "IMG";
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required in .env.local");
  }
  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const filePaths = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (filePaths.length === 0) {
    throw new Error("usage: npx tsx scripts/print-local-binarize.ts <path> [<path> ...]");
  }

  for (const fp of filePaths) {
    const tag = shortTag(fp);
    const raw = readFileSync(fp);
    console.log(`[print-local] ${fp} → tag=${tag} (${raw.length} bytes)`);

    const variants: Array<{ label: string; png: Buffer }> = [
      { label: "v1", png: await binarizeForThermalV1(raw, { mode: "atkinson" }) },
      { label: "v2", png: await binarizeForThermal(raw, { mode: "atkinson" }) },
    ];

    for (const { label, png } of variants) {
      const sticker = `${tag}-${label.toUpperCase()}`;
      const { zpl } = await renderCupLabel({
        stickerNumber: sticker,
        cupIdxOf: { idx: 1, total: 1 },
        drinkName: `${tag} ${label.toUpperCase()}`,
        modifiersText: `Binarize ${label} test`,
        doodleSvg: "",
        doodlePngBuffer: png,
      });

      const orderId = `binarize-local-${tag}-${label}-${Date.now()}`;
      const { data, error: insErr } = await sb
        .from("cup_label_jobs")
        .insert({
          square_order_id: orderId,
          line_id: "compare",
          cup_idx: 0,
          sticker_number: sticker,
          drink_name: `${tag} ${label.toUpperCase()}`,
          modifiers_text: `Binarize ${label} test`,
          doodle_source: "ai",
          doodle_pool_key: null,
          zpl_body: zpl,
          target_printer_kind: "zd410",
        })
        .select("id")
        .single();
      if (insErr) throw new Error(`insert ${sticker} failed: ${insErr.message}`);
      console.log(`  queued ${sticker} → id=${data.id} (zpl ${zpl.length} bytes)`);
    }
  }

  console.log("\nprinter-client should fire in order. Pair them by tag.");
}

main().catch((err) => {
  console.error("[print-local] failed:", err);
  process.exit(1);
});
