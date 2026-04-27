import "server-only";
import type { Order } from "square";
import { getSupabaseAdmin } from "../supabase-server";
import { pickDefaultForCup } from "../doodle/pool";
import { pathsJsonToSvg, type SvgPath } from "../doodle/render-svg";
import { loadUserDoodleUpload } from "../doodle/upload-store";
import { renderCupLabelToBitmap } from "./render-tsp100";
import { clientLineIdFromSquareLine } from "./client-line-id";

export type EnqueueCupLabelArgs = {
  order: Order;
  stickerNumber: string;
  /**
   * Optional client-supplied user doodles, keyed by `${clientLineId}:${cupIdx}`.
   * `clientLineId` matches the RN cart's buildLineId — see client-line-id.ts.
   */
  doodleIds?: Record<string, string>;
  /** Required when doodleIds is set — used to scope the storage lookup. */
  userId?: string;
};

const USER_SVG_CANVAS = 400;

type Row = {
  square_order_id: string;
  line_id: string;
  cup_idx: number;
  sticker_number: string;
  drink_name: string;
  modifiers_text: string;
  doodle_source: "default" | "user";
  doodle_pool_key: string | null;
  doodle_paths: SvgPath[] | null;
  raster_path: string;
};

export async function enqueueCupLabelJobs({
  order,
  stickerNumber,
  doodleIds,
  userId,
}: EnqueueCupLabelArgs): Promise<void> {
  const orderId = order.id!;
  const sb = getSupabaseAdmin();
  const lineItems = order.lineItems ?? [];
  const rows: Row[] = [];

  for (const [lineIdx, line] of lineItems.entries()) {
    const lineId = line.uid ?? line.catalogObjectId ?? `idx-${lineIdx}`;
    const clientLineId = clientLineIdFromSquareLine(line);
    const rawQty = Number(line.quantity ?? "1");
    const qty = Number.isFinite(rawQty) ? Math.max(0, Math.floor(rawQty)) : 0;
    const drinkName = line.name ?? "Drink";
    const modifiersText =
      (line.modifiers ?? []).map(m => m.name).filter(Boolean).join(" · ") || "—";

    for (let cupIdx = 0; cupIdx < qty; cupIdx++) {
      const userDoodleId =
        doodleIds && userId ? doodleIds[`${clientLineId}:${cupIdx}`] : undefined;

      let doodleSvg: string;
      let source: "user" | "default" = "default";
      let poolKey: string | null = null;
      let userPaths: SvgPath[] | null = null;

      if (userDoodleId && userId) {
        try {
          const paths = await loadUserDoodleUpload(userId, userDoodleId);
          doodleSvg = pathsJsonToSvg(paths, USER_SVG_CANVAS);
          source = "user";
          userPaths = paths;
        } catch (e) {
          console.error("[cup-label] user doodle load failed, falling back to default", e);
          const pool = pickDefaultForCup(clientLineId, cupIdx);
          doodleSvg = pool.svg;
          poolKey = pool.key;
        }
      } else {
        const pool = pickDefaultForCup(clientLineId, cupIdx);
        doodleSvg = pool.svg;
        poolKey = pool.key;
      }

      const bitmap = await renderCupLabelToBitmap({
        stickerNumber,
        cupIdxOf: { idx: cupIdx + 1, total: qty },
        drinkName,
        modifiersText,
        doodleSvg,
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
        doodle_source: source,
        doodle_pool_key: poolKey,
        doodle_paths: userPaths,
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
