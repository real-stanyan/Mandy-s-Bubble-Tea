// One-off: renders POOL items into full 50x80mm rasters using a sentinel
// drink name + modifiers, uploads to doodles_pool/{key}.bin.
// Re-run any time POOL changes or label layout changes.

import { POOL } from "../src/lib/doodle/pool";
import { renderCupLabelToBitmap } from "../src/lib/cup-label/render-tsp100";
import { getSupabaseAdmin } from "../src/lib/supabase-server";

async function main() {
  const sb = getSupabaseAdmin();
  for (const item of POOL) {
    const bitmap = await renderCupLabelToBitmap({
      stickerNumber: "OL000",
      cupIdxOf: { idx: 1, total: 1 },
      drinkName: "DOODLE TEMPLATE",
      modifiersText: "(modifiers placeholder)",
      doodleSvg: item.svg,
    });
    const path = `${item.key}.bin`;
    const { error } = await sb.storage
      .from("doodles_pool")
      .upload(path, bitmap, { contentType: "application/octet-stream", upsert: true });
    if (error) throw error;
    console.log(`uploaded doodles_pool/${path} (${bitmap.length} bytes)`);
  }
  console.log("done");
}

main().catch(e => { console.error(e); process.exit(1); });
