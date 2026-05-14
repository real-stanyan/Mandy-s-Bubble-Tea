import "server-only";
import type { Order } from "square";
import { getSupabaseAdmin } from "../supabase-server";
import { POOL, pickDefaultForCup } from "../doodle/pool";
import { pathsJsonToSvg, type SvgPath } from "../doodle/render-svg";
import { loadUserDoodleUpload, loadAiDoodleUpload } from "../doodle/upload-store";
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
  /**
   * Optional client-supplied AI-generated doodle IDs, keyed the same way
   * as `doodleIds`. Value is a UUID returned by /api/cup-label/ai-generate
   * which points to a pre-rendered binary PNG in the `doodles_pending`
   * Storage bucket under `{userId}/ai/{aiDoodleId}.png`. Highest priority
   * source: ai > user-drawn > preset > hash-default.
   */
  aiDoodleIds?: Record<string, string>;
  /** Required when doodleIds is set — used to scope the storage lookup. */
  userId?: string;
  /** Customer's first name for the "Hi, {name}" header. Falls back to "Guest". */
  customerFirstName?: string | null;
};

const USER_SVG_CANVAS = 400;

type Row = {
  square_order_id: string;
  line_id: string;
  cup_idx: number;
  sticker_number: string;
  drink_name: string;
  modifiers_text: string;
  doodle_source: "default" | "user" | "ai";
  doodle_pool_key: string | null;
  doodle_paths: SvgPath[] | null;
  raster_path: string;
};

export async function enqueueCupLabelJobs({
  order,
  stickerNumber,
  doodleIds,
  doodleDefaults,
  aiDoodleIds,
  userId,
  customerFirstName,
}: EnqueueCupLabelArgs): Promise<void> {
  const orderId = order.id!;
  const sb = getSupabaseAdmin();
  const lineItems = order.lineItems ?? [];
  const rows: Row[] = [];

  // Square may split a single cart line (quantity=N) into N separate
  // lineItems when applying per-cup loyalty rewards or other unit-level
  // discounts. The RN cart's slot keys are computed as
  // `${clientLineId}:${cupIdx}` where cupIdx runs 0..N-1 *across* the
  // whole quantity. So when we iterate Square's lineItems we have to
  // share a counter across all lineItems with the same clientLineId —
  // otherwise the second/third split each restart cupIdx at 0 and
  // collide on the same slot key, sending the same doodle to every cup.
  const groupCounter = new Map<string, number>();

  // Pre-compute the total cup count per clientLineId so the printed
  // "cup 2 / 3" footer reflects the whole drink group, not just the
  // current split line's local quantity (always 1 after a split).
  const groupTotal = new Map<string, number>();
  for (const line of lineItems) {
    const key = clientLineIdFromSquareLine(line);
    const q = Number(line.quantity ?? "1");
    const safeQ = Number.isFinite(q) ? Math.max(0, Math.floor(q)) : 0;
    groupTotal.set(key, (groupTotal.get(key) ?? 0) + safeQ);
  }

  for (const [lineIdx, line] of lineItems.entries()) {
    const lineId = line.uid ?? line.catalogObjectId ?? `idx-${lineIdx}`;
    const clientLineId = clientLineIdFromSquareLine(line);
    const rawQty = Number(line.quantity ?? "1");
    const qty = Number.isFinite(rawQty) ? Math.max(0, Math.floor(rawQty)) : 0;
    const drinkName = line.name ?? "Drink";
    const modifiersText = formatModifiersForLabel(line);

    for (let localIdx = 0; localIdx < qty; localIdx++) {
      const cupIdx = groupCounter.get(clientLineId) ?? 0;
      groupCounter.set(clientLineId, cupIdx + 1);
      const slotKey = `${clientLineId}:${cupIdx}`;
      const userDoodleId = doodleIds && userId ? doodleIds[slotKey] : undefined;
      const aiDoodleId = aiDoodleIds && userId ? aiDoodleIds[slotKey] : undefined;
      const presetKey = doodleDefaults?.[slotKey];

      // Dev-only diagnostic: surface any key-mismatch between the RN
      // cart's lineId and what the server reconstructs from the Square
      // order. If this prints "MISS" but the client *did* pick a preset,
      // the mismatch is the bug — investigate clientLineId algos.
      if (process.env.NODE_ENV === "development") {
        const clientChose = aiDoodleId
          ? `ai:${aiDoodleId.slice(0, 8)}`
          : presetKey
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
      let doodlePngBuffer: Buffer | undefined;
      let source: "user" | "default" | "ai" = "default";
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

      // Priority: AI > user-drawn > preset > hash default.
      // Each tier falls through on load failure so an order never fails
      // to print because of an upstream blob hiccup.
      if (aiDoodleId && userId) {
        try {
          doodlePngBuffer = await loadAiDoodleUpload(userId, aiDoodleId);
          source = "ai";
          // doodleSvg is still required by the type signature but unused
          // when doodlePngBuffer is present; pass an empty SVG.
          doodleSvg = "";
        } catch (e) {
          console.error("[cup-label] ai doodle load failed, falling back", e);
          const pool = pickPool();
          doodleSvg = pool.svg;
          poolKey = pool.key;
        }
      } else if (userDoodleId && userId) {
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

      const totalForGroup = groupTotal.get(clientLineId) ?? qty;
      const { zpl } = await renderCupLabel({
        stickerNumber,
        cupIdxOf: { idx: cupIdx + 1, total: totalForGroup },
        drinkName,
        modifiersText,
        doodleSvg,
        doodlePngBuffer,
        customerFirstName: customerFirstName ?? null,
      });

      // raster_path column historically held a TSP100 1-bit raster blob;
      // post-Zebra cutover it now points to the ZPL II text file.
      const rasterPath = `${orderId}/${lineId}_${cupIdx}.zpl`;
      // Dev guard: skip Supabase Storage upload + cup_label_jobs row so a
      // local checkout doesn't trigger the store's printer to print.
      // The Mac mini printer-client polls prod Supabase, so an unfenced
      // dev test would print a real cup label at the shop.
      // Escape hatch: MANDYS_CUP_LABEL_USE_PROD=1 forces the upload even
      // in dev, so dev-mode E2E testing of the ZD410 macbook consumer
      // works without enqueuing a print_jobs row (ZD411 stays silent).
      const useProdCupLabel = process.env.MANDYS_CUP_LABEL_USE_PROD === "1";
      if (process.env.NODE_ENV !== "development" || useProdCupLabel) {
        const { error: upErr } = await sb.storage
          .from("doodles")
          .upload(rasterPath, zpl, { contentType: "text/plain; charset=utf-8", upsert: true });
        if (upErr) throw upErr;
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
  // Same dev guard as the Storage upload above. Set
  // MANDYS_CUP_LABEL_USE_PROD=1 in dev to enqueue rows into prod
  // Supabase so a macbook printer-client can pick them up over Realtime.
  if (process.env.NODE_ENV === "development" && process.env.MANDYS_CUP_LABEL_USE_PROD !== "1") return;
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
