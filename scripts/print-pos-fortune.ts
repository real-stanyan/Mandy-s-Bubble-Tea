// scripts/print-pos-fortune.ts
//
// Real-print one POS-mode cup label with a DeepSeek-generated fortune
// in the doodle band (instead of a drawing/photo). Mirrors what the
// Square webhook does when a /^Square / order comes through — without
// needing to simulate a webhook payload.
//
//   npx tsx scripts/print-pos-fortune.ts
//   npx tsx scripts/print-pos-fortune.ts --count 3 --drink "Pearl Milk Tea"
//
// Each label gets its own DeepSeek fortune (batched as one call when
// --count > 1, matching the real per-order behaviour).

import { config as loadEnv } from "dotenv";
import path from "node:path";
import Module from "node:module";
import { createClient } from "@supabase/supabase-js";

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
const {
  generateFortunes,
} = require("../src/lib/cup-label/fortune") as typeof import("../src/lib/cup-label/fortune");

loadEnv({ path: path.resolve(__dirname, "../.env.local") });

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

  const count = Math.max(1, Number(arg("count", "1")));
  const drinkName = arg("drink", "Pearl Milk Tea");
  const modifiersText = arg("modifiers", "L.Ice -> 100%S");
  const stickerBase = arg("sticker", `POS${Date.now() % 1000}`);

  console.log(`[print-pos-fortune] requesting ${count} fortune(s) from DeepSeek...`);
  const t0 = Date.now();
  const fortunes = await generateFortunes(count);
  console.log(`[print-pos-fortune] got ${fortunes.length} fortunes in ${Date.now() - t0}ms`);
  fortunes.forEach((f, i) => console.log(`  [${i + 1}] ${f}`));

  for (let i = 0; i < count; i++) {
    const sticker = count === 1 ? stickerBase : `${stickerBase}-${i + 1}`;
    const { zpl } = await renderCupLabel({
      stickerNumber: sticker,
      cupIdxOf: { idx: i + 1, total: count },
      drinkName,
      modifiersText,
      doodleSvg: "",
      fortuneText: fortunes[i],
    });

    const orderId = `pos-fortune-test-${Date.now()}-${i}`;
    const { data, error: insErr } = await sb
      .from("cup_label_jobs")
      .insert({
        square_order_id: orderId,
        line_id: "fortune-line",
        cup_idx: i,
        sticker_number: sticker,
        drink_name: drinkName,
        modifiers_text: modifiersText,
        doodle_source: "fortune",
        doodle_pool_key: null,
        zpl_body: zpl,
        target_printer_kind: "zd410",
      })
      .select("id")
      .single();
    if (insErr) throw new Error(`insert ${sticker} failed: ${insErr.message}`);
    console.log(`  queued ${sticker} → id=${data.id} (zpl ${zpl.length} bytes)`);
  }

  console.log("\nprinter-client should fire all labels within a few seconds.");
}

main().catch((err) => {
  console.error("[print-pos-fortune] failed:", err);
  process.exit(1);
});
