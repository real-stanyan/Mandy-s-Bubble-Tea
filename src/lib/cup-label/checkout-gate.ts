import type { CupLabelSelection } from "@/store/cart";

export type CupLabelGate = "ready" | "ai-pending" | "draw-pending";

/**
 * Decide whether the Pay button may proceed, given each cup's label
 * selection in the cart. `undefined` means the customer left the cup as
 * the default — cup labels are OPTIONAL and the server draws a random
 * tarot card for any cup without a submission, so that is a valid,
 * READY state (not a blocker).
 *
 * The only thing that blocks checkout is an in-flight upload: an AI image
 * still rendering (`aiDoodleId === null`) or a drawing still uploading
 * (`userDoodleId === null`) — shipping those would lose the customer's
 * choice. Everything else (no selection / preset / photo / settled
 * AI / settled draw) is ready.
 *
 * NB: must NOT short-circuit on an unselected cup — a later cup may still
 * have a pending upload that has to block.
 */
export function computeCupLabelGate(
  selections: Array<CupLabelSelection | undefined>,
): CupLabelGate {
  for (const sel of selections) {
    if (!sel) continue; // optional — server draws a random tarot card
    if (sel.kind === "ai" && sel.aiDoodleId === null) return "ai-pending";
    if (sel.kind === "draw" && sel.userDoodleId === null) return "draw-pending";
  }
  return "ready";
}
