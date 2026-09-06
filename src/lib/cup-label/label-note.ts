// src/lib/cup-label/label-note.ts
//
// The customer's "note for the barista" on the cup label.
//
// Where the note lives on the Square order (2026-09-06):
//   * Every line item carries it as `note` — /api/orders stamps the checkout
//     note onto each line so the cup that gets made reads the request that
//     came with it. POS orders can carry staff-typed item notes in the same
//     field, so those print too.
//   * Before that change the note only rode along in the PICKUP fulfillment
//     note as "<ticket> — <note>" (the field Square Register shows). Orders
//     created before the deploy, and any reprint of them, still resolve
//     through that format. Delivery fulfillment notes bundle the address and
//     phone with the note in one string, so they are deliberately NOT mined
//     — printing a phone number on a cup would be worse than a missing note.
//
// What the label can print: the ZD410's stock ^A0 font covers Latin script
// only. CJK, emoji and control characters are dropped rather than printed
// as boxes; curly quotes and dashes are folded to their ASCII forms. If
// nothing printable is left, the label prints no note line at all — the
// full note is still on the Square ticket.

import type { Order, OrderLineItem } from "square";

/** Longest note we send to Square on a line item (its own cap is 2000). */
export const ORDER_NOTE_MAX_CHARS = 500;
/** Longest note the label will carry before it is cut with an ellipsis. */
export const LABEL_NOTE_MAX_CHARS = 120;
/** Prefix on the first printed line so the barista reads it as a request, not a modifier. */
export const NOTE_PREFIX = "Note: ";

/** Whitespace-collapse, control-strip and cap a free-text note. "" when empty. */
export function normalizeOrderNote(raw: string | null | undefined): string {
  if (!raw) return "";
  let spaced = "";
  for (const ch of raw) {
    const cp = ch.codePointAt(0) ?? 0;
    // C0 / DEL control characters (tabs, newlines, escape…) become spaces.
    spaced += cp < 0x20 || cp === 0x7f ? " " : ch;
  }
  const collapsed = spaced.replace(/\s+/g, " ").trim();
  return collapsed.length > ORDER_NOTE_MAX_CHARS
    ? collapsed.slice(0, ORDER_NOTE_MAX_CHARS).trimEnd()
    : collapsed;
}

// Typographic characters phones like to type, folded to the glyphs the
// printer font is sure to have.
const ASCII_FOLDS = new Map<number, string>([
  [0x2018, "'"], // ‘
  [0x2019, "'"], // ’
  [0x201a, "'"], // ‚
  [0x201c, '"'], // “
  [0x201d, '"'], // ”
  [0x201e, '"'], // „
  [0x2013, "-"], // –
  [0x2014, "-"], // —
  [0x2026, "..."], // …
  [0x00a0, " "], // no-break space
]);

// Printable ASCII plus Latin-1 Supplement and Latin Extended-A/B — what the
// printer's built-in font actually has glyphs for under ^CI28.
function isPrintableLatin(cp: number): boolean {
  return (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa1 && cp <= 0x024f);
}

/**
 * The note as the label prints it: normalised, folded to the printer's
 * Latin repertoire, and capped at LABEL_NOTE_MAX_CHARS (with an ellipsis
 * when cut). Returns "" when nothing printable remains.
 */
export function sanitizeLabelNote(raw: string | null | undefined): string {
  const normalized = normalizeOrderNote(raw);
  if (!normalized) return "";
  let out = "";
  for (const ch of normalized) {
    const cp = ch.codePointAt(0) ?? 0;
    const folded = ASCII_FOLDS.get(cp);
    if (folded !== undefined) out += folded;
    else if (isPrintableLatin(cp)) out += ch;
    // anything else (CJK, emoji, symbols the font lacks) is dropped
  }
  out = out.replace(/\s+/g, " ").trim();
  if (out.length > LABEL_NOTE_MAX_CHARS) {
    out = out.slice(0, LABEL_NOTE_MAX_CHARS - 1).trimEnd() + "…";
  }
  return out;
}

const DELIVERY_NOTE_MARKER = "🚚 DELIVERY";
const PICKUP_NOTE_SEP = " — ";

/**
 * The customer note carried by the order's PICKUP fulfillment note, in the
 * "<ticket> — <note>" shape /api/orders writes. Null for a bare ticket
 * number, a delivery note (address + phone, never mined), or any shape we
 * don't recognise — unknown text must not end up printed on a cup.
 */
export function customerNoteFromPickupNote(
  order: Pick<Order, "referenceId" | "ticketName" | "fulfillments">,
): string | null {
  const note = order.fulfillments?.[0]?.pickupDetails?.note?.trim();
  if (!note || note.startsWith(DELIVERY_NOTE_MARKER)) return null;
  const refs = [order.referenceId, order.ticketName].filter(
    (r): r is string => typeof r === "string" && r.length > 0,
  );
  for (const ref of refs) {
    if (note === ref) return null;
    const prefix = `${ref}${PICKUP_NOTE_SEP}`;
    if (note.startsWith(prefix)) {
      const rest = normalizeOrderNote(note.slice(prefix.length));
      return rest || null;
    }
  }
  return null;
}

/**
 * The note to print on this line's cups: the line item's own note first
 * (web/app checkout stamps it there; POS staff can type one), else the
 * legacy pickup-note fallback. Null when there is nothing to print.
 */
export function customerNoteForLine(
  order: Pick<Order, "referenceId" | "ticketName" | "fulfillments">,
  line: Pick<OrderLineItem, "note">,
): string | null {
  const own = normalizeOrderNote(line.note);
  if (own) return own;
  return customerNoteFromPickupNote(order);
}
