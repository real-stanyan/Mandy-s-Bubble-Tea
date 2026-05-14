import "server-only";
import type { Order } from "square";
import { getSupabaseAdmin } from "../supabase-server";
import { POOL, pickDefaultForCup } from "../doodle/pool";
import { pathsJsonToSvg, type SvgPath } from "../doodle/render-svg";
import { loadUserDoodleUpload } from "../doodle/upload-store";
import { renderCupLabel } from "./render-zebra-cup";
import { clientLineIdFromSquareLine } from "./client-line-id";
import { formatModifiersForLabel } from "./format-modifiers";

export type EnqueueCupLabelArgs = {
  order: Order;
  stickerNumber: string;
  /**
   * Optional client-supplied user doodles, keyed by `${clientLineId}:${cupIdx}`.
   * `clientLineId` matches the RN cart's buildLineId — see client-line-id.ts.
   */
  doodleIds?: Record<string, string>;
  /**
   * Optional client-supplied preset picks, keyed the same way as `doodleIds`.
   * Value is a key from POOL (see ../doodle/pool.ts). Used when the user
   * picked a preset rather than drawing — overrides the hash-based default.
   * `doodleIds` (user-drawn) takes precedence over `doodleDefaults` for the
   * same slot.
   */
  doodleDefaults?: Record<string, string>;
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
  doodleDefaults,
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
    const modifiersText = formatModifiersForLabel(line);

    for (let cupIdx = 0; cupIdx < qty; cupIdx++) {
      const slotKey = `${clientLineId}:${cupIdx}`;
      const userDoodleId = doodleIds && userId ? doodleIds[slotKey] : undefined;
      const presetKey = doodleDefaults?.[slotKey];

      // Dev-only diagnostic: surface any key-mismatch between the RN
      // cart's lineId and what the server reconstructs from the Square
      // order. If this prints "MISS" but the client *did* pick a preset,
      // the mismatch is the bug — investigate clientLineId algos.
      if (process.env.NODE_ENV === "development") {
        const clientChose = presetKey
          ? `preset:${presetKey}`
          : userDoodleId
            ? `drawn:${userDoodleId.slice(0, 8)}`
            : "MISS";
        console.log(
          `[cup-label dev] slot ${slotKey} → ${clientChose}` +
          (doodleDefaults ? ` | doodleDefaults keys: ${JSON.stringify(Object.keys(doodleDefaults))}` : ""),
        );
      }

      let doodleSvg: string;
      let source: "user" | "default" = "default";
      let poolKey: string | null = null;
      let userPaths: SvgPath[] | null = null;

      const pickPool = (): { key: string; svg: string } => {
        if (presetKey) {
          const match = POOL.find(p => p.key === presetKey);
          if (match) return match;
          // Unknown key from client — log + fall through to hash default so
          // we still print *something* (don't fail the whole enqueue).
          console.warn(`[cup-label] unknown preset key ${JSON.stringify(presetKey)}, falling back to hash default`);
        }
        return pickDefaultForCup(clientLineId, cupIdx);
      };

      if (userDoodleId && userId) {
        try {
          const paths = await loadUserDoodleUpload(userId, userDoodleId);
          doodleSvg = pathsJsonToSvg(paths, USER_SVG_CANVAS);
          source = "user";
          userPaths = paths;
        } catch (e) {
          console.error("[cup-label] user doodle load failed, falling back to default", e);
          const pool = pickPool();
          doodleSvg = pool.svg;
          poolKey = pool.key;
        }
      } else {
        const pool = pickPool();
        doodleSvg = pool.svg;
        poolKey = pool.key;
      }

      const { zpl, previewPng } = await renderCupLabel({
        stickerNumber,
        cupIdxOf: { idx: cupIdx + 1, total: qty },
        drinkName,
        modifiersText,
        doodleSvg,
      });

      // raster_path column historically held a TSP100 1-bit raster blob;
      // post-Zebra cutover it now points to the ZPL II text file.
      const rasterPath = `${orderId}/${lineId}_${cupIdx}.zpl`;
      // Dev guard: skip Supabase Storage upload + cup_label_jobs row so a
      // local checkout doesn't trigger the store's printer to print.
      // The Mac mini printer-client polls prod Supabase, so an unfenced
      // dev test would print a real cup label at the shop.
      if (process.env.NODE_ENV !== "development") {
        const { error: upErr } = await sb.storage
          .from("doodles")
          .upload(rasterPath, zpl, { contentType: "text/plain; charset=utf-8", upsert: true });
        if (upErr) throw upErr;
      }

      // Dev-only: also dump a viewable PNG preview to ~/Desktop/ so we can
      // eyeball labels without a real printer. Writes are best-effort —
      // failures here must never break the print queue path.
      // Strict `development` gate so vitest (NODE_ENV=test) and prod don't
      // litter the filesystem.
      if (process.env.NODE_ENV === "development") {
        try {
          const fs = await import("node:fs/promises");
          const path = await import("node:path");
          const home = process.env.HOME ?? "/tmp";
          const safeName = drinkName.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 40);
          const file = path.join(
            home,
            "Desktop",
            `cuplabel_${stickerNumber}_cup${cupIdx + 1}of${qty}_${safeName}.png`,
          );
          await fs.writeFile(file, previewPng);
          console.log(`[cup-label dev] preview PNG → ${file}`);
        } catch (e) {
          console.error("[cup-label dev] PNG dump failed (non-fatal)", e);
        }
      }

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
  // Same dev guard as the Storage upload above: in dev we already wrote
  // PNG previews to ~/Desktop, so we don't enqueue anything to the prod
  // print queue.
  if (process.env.NODE_ENV === "development") return;
  // "Authoritative" = caller passed an explicit user choice (drawn or
  // preset). When the webhook later runs without a choice, its rows are
  // skipped on conflict so the user's pick survives.
  const hasAuthoritativeChoice =
    (doodleIds && Object.keys(doodleIds).length > 0) ||
    (doodleDefaults && Object.keys(doodleDefaults).length > 0);
  const { error: insErr } = await sb
    .from("cup_label_jobs")
    .upsert(rows, {
      onConflict: "square_order_id,line_id,cup_idx",
      ignoreDuplicates: !hasAuthoritativeChoice,
    });
  if (insErr) throw insErr;
}
