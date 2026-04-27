import "server-only";
import type { Order } from "square";
import { getSupabaseAdmin } from "../supabase-server";
import { pickDefaultForCup } from "../doodle/pool";
import { renderCupLabelToBitmap } from "./render-tsp100";

export type EnqueueCupLabelArgs = {
  order: Order;
  stickerNumber: string;
};

export async function enqueueCupLabelJobs({ order, stickerNumber }: EnqueueCupLabelArgs): Promise<void> {
  const orderId = order.id!;
  const sb = getSupabaseAdmin();
  const lineItems = order.lineItems ?? [];

  type Row = {
    square_order_id: string;
    line_id: string;
    cup_idx: number;
    sticker_number: string;
    drink_name: string;
    modifiers_text: string;
    doodle_source: "default";
    doodle_pool_key: string;
    raster_path: string;
  };

  const rows: Row[] = [];

  for (const [lineIdx, line] of lineItems.entries()) {
    const lineId = line.uid ?? line.catalogObjectId ?? `idx-${lineIdx}`;
    const rawQty = Number(line.quantity ?? "1");
    const qty = Number.isFinite(rawQty) ? Math.max(0, Math.floor(rawQty)) : 0;
    const drinkName = line.name ?? "Drink";
    const modifiersText = (line.modifiers ?? []).map(m => m.name).filter(Boolean).join(" · ") || "—";

    for (let cupIdx = 0; cupIdx < qty; cupIdx++) {
      const pool = pickDefaultForCup(lineId, cupIdx);
      const bitmap = await renderCupLabelToBitmap({
        stickerNumber,
        cupIdxOf: { idx: cupIdx + 1, total: qty },
        drinkName,
        modifiersText,
        doodleSvg: pool.svg,
      });

      const rasterPath = `${orderId}/${lineId}_${cupIdx}.bin`;
      const { error: upErr } = await sb.storage
        .from("doodles")
        .upload(rasterPath, bitmap, { contentType: "application/octet-stream", upsert: true });
      if (upErr) throw upErr;

      rows.push({
        square_order_id: orderId,
        line_id: lineId,
        cup_idx: cupIdx,
        sticker_number: stickerNumber,
        drink_name: drinkName,
        modifiers_text: modifiersText,
        doodle_source: "default",
        doodle_pool_key: pool.key,
        raster_path: rasterPath,
      });
    }
  }

  if (rows.length === 0) return;
  const { error: insErr } = await sb
    .from("cup_label_jobs")
    .upsert(rows, { onConflict: "square_order_id,line_id,cup_idx", ignoreDuplicates: true });
  if (insErr) throw insErr;
}
