// Cup-label paper mode switch.
//
// 2026-08-26: the 50×80mm photo-label roll ran out, so the shop is
// temporarily back on the older 40×30mm stock. That paper is too small
// for doodle/photo raster art, so while it's loaded:
//   • labels render TEXT-ONLY (ticket number + order details, big fonts)
//     — see render-text-label.ts
//   • the customer-facing photo/draw/AI label feature is offline on web
//     and app, with a "back in ~two weeks" notice
//
// When the 50×80 roll is back: flip CUP_LABEL_PAPER_MODE to
// "photo-50x80" and everything (renderer, checkout UI, upload APIs)
// returns to the photo pipeline in one change. The full pre-switch tree
// is also snapshotted on branch `photo-mode-50x80` as belt-and-braces.
//
// Deliberately a compile-time constant, not an env var: the paper in the
// printer is physical state — changing it must ride a deploy someone
// consciously ships, not an env flip that can drift per environment.

export type CupLabelPaperMode = "text-40x30" | "photo-50x80";

// Indirection through a function keeps TS from narrowing the const to
// its literal, which would make the flag comparison below a type error.
function currentPaperMode(): CupLabelPaperMode {
  return "photo-50x80";
}

export const CUP_LABEL_PAPER_MODE: CupLabelPaperMode = currentPaperMode();

/** True while the small text-only paper is loaded → photo/draw/AI label
 *  submissions are rejected and the pickers are hidden. */
export const PHOTO_LABELS_OFFLINE = CUP_LABEL_PAPER_MODE !== "photo-50x80";

/** Customer-facing copy shown wherever the picker used to live. */
export const PHOTO_LABELS_OFFLINE_NOTICE =
  "Photo & custom cup labels are taking a short break — back in about two weeks. " +
  "Your cups will get a clear label with your order number and drink details instead.";
