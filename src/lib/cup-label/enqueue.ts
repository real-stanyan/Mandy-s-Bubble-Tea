import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Order } from "square";
import { getSupabaseAdmin } from "../supabase-server";
import { POOL, pickDefaultForCup } from "../doodle/pool";
import { pathsJsonToSvg, type SvgPath } from "../doodle/render-svg";
import { loadUserDoodleUpload, loadAiDoodleUpload } from "../doodle/upload-store";
import { renderCupLabel } from "./render-zebra-cup";
import { clientLineIdFromSquareLine } from "./client-line-id";
import { formatModifiersForLabel } from "./format-modifiers";
import { generateFortunes } from "./fortune";

// Static gallery preset stickers live in the Next.js public/ tree. They're
// committed PNGs (1-bit Atkinson-dithered for thermal output), keyed by md5
// hash. The web/app checkout LabelPicker writes the chosen hash into
// labelSelections; we read the binarized PNG from disk and route it through
// the same `doodlePngBuffer` path as AI-generated and user-photo doodles.
const GALLERY_DIR = path.join(process.cwd(), "public", "cup-label", "gallery");
// Hard cap on the hash string we accept from the client — md5 hex is 32
// chars, sticker_N_no_bg shims fit under 32, anything longer is hostile.
const GALLERY_HASH_MAX_LEN = 64;
const GALLERY_HASH_RE = /^[A-Za-z0-9_-]{1,64}$/;

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
  /**
   * Optional client-supplied gallery sticker picks, keyed the same way as
   * `doodleIds`. Value is the md5-style hash of a sticker in
   * `public/cup-label/gallery/`. The server reads
   * `<repo>/public/cup-label/gallery/<hash>/binarized.png` from disk at
   * enqueue time and routes the buffer through `renderCupLabel`'s
   * `doodlePngBuffer` path — no Supabase Storage hop. Priority:
   * ai > drawn > presetSticker > POOL preset (doodleDefaults) > hash-default.
   * Unlike aiDoodleIds, this path does NOT require a userId — gallery
   * stickers are public static assets.
   */
  presetStickerHashes?: Record<string, string>;
  /** Required when doodleIds is set — used to scope the storage lookup. */
  userId?: string;
  /** Customer's first name for the "Hi, {name}" header. Falls back to "Guest". */
  customerFirstName?: string | null;
  /**
   * "web" (default): web/app checkout — honor doodleIds / aiDoodleIds /
   * doodleDefaults, fall back to hash-based POOL preset.
   * "pos": in-store Square POS order coming in via the webhook — there's
   * no app-side doodle choice. Every cup gets a unique fortune-cookie
   * sentence in place of the doodle, generated server-side via DeepSeek
   * with a hand-curated fallback pool when the upstream is unreachable.
   * See `lib/cup-label/fortune.ts`.
   */
  mode?: "web" | "pos";
};

const USER_SVG_CANVAS = 400;

type Row = {
  square_order_id: string;
  line_id: string;
  cup_idx: number;
  sticker_number: string;
  drink_name: string;
  modifiers_text: string;
  doodle_source: "default" | "user" | "ai" | "fortune" | "preset_sticker";
  doodle_pool_key: string | null;
  doodle_paths: SvgPath[] | null;
  // Legacy column from the Storage-backed pipeline. Always null on new
  // rows now that ZPL lives in `zpl_body`. Kept nullable in the schema
  // so old rows with `raster_path` set are still readable by the
  // printer-client fallback path. Will be dropped once all old rows
  // have either printed or been archived.
  raster_path: string | null;
  // ZPL II text rendered inline. Replaces the previous Storage hop
  // (upload to `doodles` bucket → printer-client downloads). Inline
  // avoids the partial-state window where the bucket upload succeeded
  // but the row insert failed (or vice-versa), and shaves one HTTP
  // round-trip off the printer hot path.
  zpl_body: string;
  // Routes the row to the right consumer. ZD410 USB cup-label printer
  // gets `zd410`. Future ZD411 retirement bridge or back-of-house
  // printer would add their own kinds with their own filtered
  // Realtime subscriptions in printer-client.
  target_printer_kind: "zd410";
  // For the admin cup-doodles gallery. Points at the customer's color
  // original (Doubao raw output for AI cups, raw photo upload for
  // photo cups). NULL for default / drawn / fortune / preset cups —
  // those have no "original image" worth showing in the gallery.
  original_image_path: string | null;
  // FK to cup_label_ai_jobs when the source is AI. Lets the admin
  // gallery join the customer's prompt without a path-LIKE hack.
  ai_job_id: string | null;
};

export async function enqueueCupLabelJobs({
  order,
  stickerNumber,
  doodleIds,
  doodleDefaults,
  aiDoodleIds,
  presetStickerHashes,
  userId,
  customerFirstName,
  mode = "web",
}: EnqueueCupLabelArgs): Promise<void> {
  const orderId = order.id!;
  const sb = getSupabaseAdmin();
  const lineItems = order.lineItems ?? [];
  const rows: Row[] = [];

  // POS path: pre-fetch one fortune per cup before the per-line loop
  // so we make a single DeepSeek call for the whole order (5-cup POS
  // ticket = 1 round-trip, not 5). Fortunes are then consumed in
  // cup-emission order. generateFortunes() always returns exactly N
  // strings — falls back to its hand-curated pool on any failure.
  let fortunes: string[] = [];
  let fortuneCursor = 0;
  if (mode === "pos") {
    const totalCups = lineItems.reduce((sum, line) => {
      const q = Number(line.quantity ?? "1");
      return sum + (Number.isFinite(q) ? Math.max(0, Math.floor(q)) : 0);
    }, 0);
    if (totalCups > 0) {
      fortunes = await generateFortunes(totalCups);
    }
  }

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
      const presetStickerRaw = presetStickerHashes?.[slotKey];
      const presetStickerHash =
        typeof presetStickerRaw === "string" &&
        presetStickerRaw.length <= GALLERY_HASH_MAX_LEN &&
        GALLERY_HASH_RE.test(presetStickerRaw)
          ? presetStickerRaw
          : undefined;
      const presetKey = doodleDefaults?.[slotKey];

      // Dev-only diagnostic: surface any key-mismatch between the RN
      // cart's lineId and what the server reconstructs from the Square
      // order. If this prints "MISS" but the client *did* pick a preset,
      // the mismatch is the bug — investigate clientLineId algos.
      if (process.env.NODE_ENV === "development") {
        const clientChose = aiDoodleId
          ? `ai:${aiDoodleId.slice(0, 8)}`
          : presetStickerHash
            ? `sticker:${presetStickerHash.slice(0, 8)}`
            : presetKey
              ? `preset:${presetKey}`
              : userDoodleId
                ? `drawn:${userDoodleId.slice(0, 8)}`
                : "MISS";
        console.log(
          `[cup-label dev] slot ${slotKey} → ${clientChose}` +
          (presetStickerHashes
            ? ` | presetStickerHashes keys: ${JSON.stringify(Object.keys(presetStickerHashes))}`
            : "") +
          (doodleDefaults
            ? ` | doodleDefaults keys: ${JSON.stringify(Object.keys(doodleDefaults))}`
            : ""),
        );
      }

      let doodleSvg: string;
      let doodlePngBuffer: Buffer | undefined;
      let fortuneText: string | undefined;
      let source: "user" | "default" | "ai" | "fortune" | "preset_sticker" = "default";
      let poolKey: string | null = null;
      let userPaths: SvgPath[] | null = null;
      // Admin cup-doodles gallery — color-original tracking. Populated
      // only on the AI / photo-upload branches below; left null for
      // default / drawn / fortune cups.
      let originalImagePath: string | null = null;
      let aiJobId: string | null = null;

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

      // POS mode short-circuits the whole doodle resolution chain —
      // there's no app, no user choice, no preset. Each cup gets the
      // next fortune off the pre-fetched batch.
      if (mode === "pos") {
        fortuneText = fortunes[fortuneCursor++] ?? "Today is your lucky day";
        source = "fortune";
        doodleSvg = "";
      } else if (presetStickerHash) {
        // Static gallery sticker — committed PNG under public/cup-label/gallery.
        // Read the pre-binarized (1-bit Atkinson-dithered) variant directly so
        // sharp doesn't soften it back into greyscale before ZPL packing.
        try {
          const filePath = path.join(GALLERY_DIR, presetStickerHash, "binarized.png");
          doodlePngBuffer = await fs.readFile(filePath);
          source = "preset_sticker";
          poolKey = presetStickerHash;
          originalImagePath = `cup-label/gallery/${presetStickerHash}/binarized.png`;
          doodleSvg = "";
        } catch (e) {
          console.error(
            "[cup-label] preset sticker load failed, falling back to hash default",
            { hash: presetStickerHash, error: e instanceof Error ? e.message : e },
          );
          const pool = pickPool();
          doodleSvg = pool.svg;
          poolKey = pool.key;
        }
      } else if (aiDoodleId && userId) {
        try {
          doodlePngBuffer = await loadAiDoodleUpload(userId, aiDoodleId);
          source = "ai";
          // doodleSvg is still required by the type signature but unused
          // when doodlePngBuffer is present; pass an empty SVG.
          doodleSvg = "";

          // Admin gallery wiring — the aiDoodleId from the cart is
          // either a cup_label_ai_jobs row id (Doubao AI path) or a
          // cup_label_upload_jobs row id (photo upload path). The
          // client uses the same map for both. Look up both tables;
          // exactly one will hit. Failure is non-fatal — the cup
          // still prints; it just doesn't show in the gallery.
          try {
            const { data: aiRow } = await sb
              .from("cup_label_ai_jobs")
              .select("original_png_path")
              .eq("id", aiDoodleId)
              .maybeSingle();
            if (aiRow?.original_png_path) {
              originalImagePath = aiRow.original_png_path;
              aiJobId = aiDoodleId;
            } else {
              const { data: upRow } = await sb
                .from("cup_label_upload_jobs")
                .select("original_path")
                .eq("id", aiDoodleId)
                .maybeSingle();
              if (upRow?.original_path) {
                originalImagePath = upRow.original_path;
              }
            }
          } catch (lookupErr) {
            console.warn(
              "[cup-label] gallery lookup failed (non-fatal)",
              lookupErr,
            );
          }
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
        fortuneText,
        customerFirstName: customerFirstName ?? null,
      });

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
        raster_path: null,
        zpl_body: zpl,
        target_printer_kind: "zd410",
        original_image_path: originalImagePath,
        ai_job_id: aiJobId,
      });
    }
  }

  if (rows.length === 0) return;
  // Dev guard: a local checkout would otherwise enqueue real rows into
  // prod Supabase and the Mac mini printer-client would print them at
  // the shop. MANDYS_CUP_LABEL_USE_PROD=1 is the dev-mode E2E escape
  // hatch used when testing a macbook-attached ZD410 against prod
  // Realtime without enqueuing print_jobs (ZD411 stays silent).
  if (process.env.NODE_ENV === "development" && process.env.MANDYS_CUP_LABEL_USE_PROD !== "1") return;
  // "Authoritative" = caller passed an explicit user choice (drawn or
  // preset). When the webhook later runs without a choice, its rows are
  // skipped on conflict so the user's pick survives.
  const hasAuthoritativeChoice =
    (doodleIds && Object.keys(doodleIds).length > 0) ||
    (doodleDefaults && Object.keys(doodleDefaults).length > 0) ||
    (aiDoodleIds && Object.keys(aiDoodleIds).length > 0) ||
    (presetStickerHashes && Object.keys(presetStickerHashes).length > 0);
  const { error: insErr } = await sb
    .from("cup_label_jobs")
    .upsert(rows, {
      onConflict: "square_order_id,line_id,cup_idx",
      ignoreDuplicates: !hasAuthoritativeChoice,
    });
  if (insErr) throw insErr;
}
