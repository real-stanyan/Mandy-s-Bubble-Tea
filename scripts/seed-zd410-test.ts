// scripts/seed-zd410-test.ts
//
// Service-role seed script for end-to-end testing the ZD410 cup-label
// pipeline without going through the web admin endpoint (which requires
// owner SSR session). Renders one cup label, uploads the ZPL to the
// `doodles` bucket, and inserts a `cup_label_jobs` row — the dev or
// launchd cup-label consumer on the host picks it up via Realtime and
// fires it at the ZD410.
//
// Usage:
//   cd ~/Github/mandys_bubble_tea
//   npx tsx scripts/seed-zd410-test.ts
//   npx tsx scripts/seed-zd410-test.ts --pool sakura_car --drink "Mango Slushy"
//   npx tsx scripts/seed-zd410-test.ts --sticker OL818 --modifiers "Pearls -> L.Ice -> 50%S"
//
// Required env (read from .env.local in repo root):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { config as loadEnv } from "dotenv";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { renderCupLabel } from "../src/lib/cup-label/render-zebra-cup";
import { POOL } from "../src/lib/doodle/pool";

loadEnv({ path: path.resolve(__dirname, "../.env.local") });
loadEnv();

function arg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? (process.argv[idx + 1] ?? fallback) : fallback;
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing — populate .env.local first",
    );
  }
  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const stickerNumber = arg("sticker", "OL818");
  const drinkName = arg("drink", "Blueberry Slushy");
  const modifiersText = arg("modifiers", "Pearls -> L.Ice -> 50%S");
  const poolKey = arg("pool", "sakura_car");
  const cupIdx = Number(arg("cup", "0"));
  const cupTotal = Number(arg("total", "1"));

  const item = POOL.find((p) => p.key === poolKey);
  if (!item) {
    throw new Error(`unknown pool key "${poolKey}". Available: ${POOL.map((p) => p.key).join(", ")}`);
  }

  console.log(`[seed-zd410] rendering ZPL for sticker=${stickerNumber} cup=${cupIdx + 1}/${cupTotal} drink="${drinkName}" pool=${poolKey}`);

  const { zpl } = await renderCupLabel({
    stickerNumber,
    cupIdxOf: { idx: cupIdx + 1, total: cupTotal },
    drinkName,
    modifiersText,
    doodleSvg: item.svg,
  });

  const orderId = `zd410-test-${Date.now()}`;
  const lineId = "test-line";
  const rasterPath = `${orderId}/${lineId}_${cupIdx}.zpl`;

  const { error: upErr } = await sb.storage
    .from("doodles")
    .upload(rasterPath, zpl, { contentType: "text/plain; charset=utf-8", upsert: true });
  if (upErr) throw new Error(`storage upload failed: ${upErr.message}`);
  console.log(`[seed-zd410] uploaded ZPL → doodles/${rasterPath} (${zpl.length} bytes)`);

  const { data, error: insErr } = await sb
    .from("cup_label_jobs")
    .insert({
      square_order_id: orderId,
      line_id: lineId,
      cup_idx: cupIdx,
      sticker_number: stickerNumber,
      drink_name: drinkName,
      modifiers_text: modifiersText,
      doodle_source: "default",
      doodle_pool_key: poolKey,
      raster_path: rasterPath,
    })
    .select("id")
    .single();
  if (insErr) throw new Error(`insert failed: ${insErr.message}`);

  console.log(`[seed-zd410] inserted cup_label_jobs id=${data.id}`);
  console.log("");
  console.log("Now watch the cup-label consumer log (npm run dev:cup-label) — within a second");
  console.log("you should see [cup-label/queue] printed " + stickerNumber + " ...");
  console.log("and the ZD410 should fire the label.");
}

main().catch((err) => {
  console.error("[seed-zd410] failed:", err);
  process.exit(1);
});
