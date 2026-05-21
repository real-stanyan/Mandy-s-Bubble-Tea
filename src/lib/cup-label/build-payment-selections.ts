import type { CupLabelSelection } from "@/store/cart";

export interface PaymentSelectionsPayload {
  presetStickerHashes: Record<string, string> | undefined;
  aiDoodleIds: Record<string, string> | undefined;
}

/** Split the cart's discriminated union into the two parallel maps
 *  /api/payment accepts. Photo and AI both land in `aiDoodleIds` —
 *  the server's enqueueCupLabelJobs treats them identically.
 *  Empty results become `undefined` so the JSON payload doesn't
 *  carry `{}` (route validator skips when undefined). */
export function buildPaymentSelections(
  selections: Record<string, CupLabelSelection>,
): PaymentSelectionsPayload {
  const presetStickerHashes: Record<string, string> = {};
  const aiDoodleIds: Record<string, string> = {};
  for (const [slotKey, sel] of Object.entries(selections)) {
    if (sel.kind === "preset") presetStickerHashes[slotKey] = sel.hash;
    else if (sel.kind === "photo") aiDoodleIds[slotKey] = sel.uploadedDoodleId;
    else aiDoodleIds[slotKey] = sel.aiDoodleId;
  }
  return {
    presetStickerHashes: Object.keys(presetStickerHashes).length ? presetStickerHashes : undefined,
    aiDoodleIds: Object.keys(aiDoodleIds).length ? aiDoodleIds : undefined,
  };
}
