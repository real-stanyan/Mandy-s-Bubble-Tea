import type { CupLabelSelection } from "@/store/cart";

export interface PaymentSelectionsPayload {
  presetStickerHashes: Record<string, string> | undefined;
  aiDoodleIds: Record<string, string> | undefined;
  doodleIds: Record<string, string> | undefined;
}

/** Split the cart's discriminated union into the three parallel maps
 *  /api/payment accepts. Photo and AI both land in `aiDoodleIds` —
 *  the server's enqueueCupLabelJobs treats them identically. Draw lands
 *  in `doodleIds` (the legacy field name; server still reads it via
 *  loadUserDoodleUpload for the SVG-paths render path).
 *  Empty results become `undefined` so the JSON payload doesn't
 *  carry `{}` (route validator skips when undefined). */
export function buildPaymentSelections(
  selections: Record<string, CupLabelSelection>,
): PaymentSelectionsPayload {
  const presetStickerHashes: Record<string, string> = {};
  const aiDoodleIds: Record<string, string> = {};
  const doodleIds: Record<string, string> = {};
  for (const [slotKey, sel] of Object.entries(selections)) {
    if (sel.kind === "preset") presetStickerHashes[slotKey] = sel.hash;
    else if (sel.kind === "photo") aiDoodleIds[slotKey] = sel.uploadedDoodleId;
    else if (sel.kind === "draw") {
      if (sel.userDoodleId !== null) doodleIds[slotKey] = sel.userDoodleId;
      // draw with userDoodleId=null → upload still in flight. The Pay
      // gate refuses this state, so we shouldn't see it here in
      // practice, but stay defensive — skip and let server fall back.
    } else if (sel.aiDoodleId !== null) aiDoodleIds[slotKey] = sel.aiDoodleId;
    // ai with aiDoodleId=null → background submit still pending. Skip
    // so the route doesn't get a missing id; server enqueue falls back
    // to the gallery default for that slot (acceptable race rather than
    // blocking the Pay button on the background submit).
  }
  return {
    presetStickerHashes: Object.keys(presetStickerHashes).length ? presetStickerHashes : undefined,
    aiDoodleIds: Object.keys(aiDoodleIds).length ? aiDoodleIds : undefined,
    doodleIds: Object.keys(doodleIds).length ? doodleIds : undefined,
  };
}
