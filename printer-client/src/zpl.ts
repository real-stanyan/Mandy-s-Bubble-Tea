// printer-client/src/zpl.ts

export type CupForZPL = {
  stickerNumber: string;   // e.g. 'OL812' or 'TA47$**'
  orderTime: string;       // 'HH:mm' in store local time
  drinkName: string;
  toppings: string[];      // multiple join with '+'
  ice: string | null;
  sugar: string | null;
  cupIndex: number;        // 1-based
  cupTotal: number;
  priceCents: number;      // e.g. 700 -> '$7.00'
  // Customer first name — rendered below the sticker number so
  // staff can call it out. Only populated for web (OL...) orders;
  // null for POS walk-ins.
  customerName: string | null;
};

/**
 * Render one cup sticker as a ZPL string for Zebra ZD411 at 203 dpi.
 * Label: 40 mm wide x 30 mm tall -> 320 x 240 dots.
 *
 * Layout (top to bottom):
 *   1. Order number (left, large) + time (right, medium)
 *   2. Drink name (medium, auto-wrap up to 2 lines)
 *   3. Toppings -> Ice -> Sugar (small, auto-wrap up to 2 lines)
 *   4. Cup index/total (left) + price (right)
 *
 * Right-aligned items use ^FB with the R justifier so they always
 * land flush against the right margin regardless of text length.
 */
// Rough max characters that fit in 2 wrapped lines on our 290-dot
// usable width at the given font heights. These are conservative
// (proportional font 0, widest glyph ~ height). If over, we append
// an ellipsis so staff can tell the label was truncated rather than
// having ZPL silently drop characters.
const MAX_DRINK_CHARS = 44;
const MAX_MOD_CHARS = 52;

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// Customer name auto-sizing. Short names render big and readable from
// across the counter; long names shrink so they don't crowd the drink
// row or force ugly ellipses. Glyph-width-to-height ratio for font 0
// is ~0.6. We pick the biggest height that keeps the full name on one
// line, clamped to [MIN, MAX] for visual consistency. If even the min
// height can't fit the name, the name is truncated with an ellipsis.
const NAME_MAX_HEIGHT = 48;
const NAME_MIN_HEIGHT = 22;
const NAME_GLYPH_RATIO = 0.6;

function pickNameHeight(len: number, usableWidth: number): number {
  if (len <= 0) return NAME_MAX_HEIGHT;
  const byWidth = Math.floor(usableWidth / (NAME_GLYPH_RATIO * len));
  return Math.max(NAME_MIN_HEIGHT, Math.min(NAME_MAX_HEIGHT, byWidth));
}

function maxCharsAtHeight(height: number, usableWidth: number): number {
  return Math.max(1, Math.floor(usableWidth / (NAME_GLYPH_RATIO * height)));
}

export function renderStickerZPL(cup: CupForZPL): string {
  const dollars = (cup.priceCents / 100).toFixed(2);
  const cupFrac = `${cup.cupIndex}/${cup.cupTotal}`;
  const toppings = cup.toppings.length > 0 ? cup.toppings.join("+") : "";
  const ice = cup.ice ?? "";
  const sugar = cup.sugar ?? "";
  const modifierLine = truncate(
    `${toppings} -> ${ice} -> ${sugar}`.trim(),
    MAX_MOD_CHARS,
  );
  const drinkName = truncate(cup.drinkName, MAX_DRINK_CHARS);

  // Label geometry (40x30mm @ 203dpi).
  const PW = 320;
  const LL = 240;
  const LEFT = 15;
  const RIGHT_PAD = 15;
  const W = PW - LEFT - RIGHT_PAD; // usable width for wrap/right-align
  const TOP = 6;
  const BOTTOM = 4;
  const ROW_GAP = 2;

  // Font heights in dots (font 0, scalable).
  const H_NUM = 38;
  const H_TIME = 22;
  const H_DRINK = 24;
  const H_MOD = 20;
  const H_FOOT = 22;

  // Bottom-anchor the footer so the price+cup-count row ALWAYS lands
  // on the label regardless of how tall the rows above end up. The
  // body (drink, modifiers) is rendered top-down and capped at this
  // y so it can't bleed into or past the footer area.
  const FOOTER_Y = LL - BOTTOM - H_FOOT;
  const BODY_MAX_Y = FOOTER_Y - ROW_GAP;

  let y = TOP;

  const parts: string[] = [];
  parts.push("^XA");
  parts.push(`^PW${PW}`);
  parts.push(`^LL${LL}`);
  parts.push("^CI28");         // UTF-8

  // Row 1: sticker number (left, big) + time (right, smaller, vertically centered-ish)
  parts.push(
    `^FO${LEFT},${y}^A0N,${H_NUM},${H_NUM}^FD${escapeZpl(cup.stickerNumber)}^FS`,
  );
  parts.push(
    `^FO${LEFT},${y + (H_NUM - H_TIME) / 2}^A0N,${H_TIME},${H_TIME}^FB${W},1,0,R,0^FD${escapeZpl(cup.orderTime)}^FS`,
  );
  y += H_NUM + ROW_GAP;

  // Row 1b: customer first name (web orders only). POS walk-ins
  // don't supply a name, so skip the row entirely and keep the
  // layout compact. The name is capped by the vertical space left
  // after reserving room for the drink row, modifier row, and the
  // bottom-anchored footer, so it never pushes other fields off
  // the label.
  if (cup.customerName) {
    const reservedBody = H_DRINK * 2 + ROW_GAP + H_MOD * 2 + ROW_GAP;
    const maxByVertical = BODY_MAX_Y - y - reservedBody;
    const maxByWidth = pickNameHeight(cup.customerName.length, W);
    const h = Math.max(NAME_MIN_HEIGHT, Math.min(maxByWidth, maxByVertical));
    const name = truncate(cup.customerName, maxCharsAtHeight(h, W));
    parts.push(
      `^FO${LEFT},${y}^A0N,${h},${h}^FD${escapeZpl(name)}^FS`,
    );
    y += h + ROW_GAP;
  }

  // Row 2: drink name, wrap up to 2 lines
  parts.push(
    `^FO${LEFT},${y}^A0N,${H_DRINK},${H_DRINK}^FB${W},2,2,L,0^FD${escapeZpl(drinkName)}^FS`,
  );
  y += H_DRINK * 2 + ROW_GAP;

  // Row 3: modifiers, wrap up to 2 lines (but never bleed into the
  // footer strip — if the modifier row would overlap the price, drop
  // it to a single line rather than losing the price).
  const modLines = y + H_MOD * 2 > BODY_MAX_Y ? 1 : 2;
  parts.push(
    `^FO${LEFT},${y}^A0N,${H_MOD},${H_MOD}^FB${W},${modLines},2,L,0^FD${escapeZpl(modifierLine)}^FS`,
  );

  // Row 4: cup fraction (left) + price (right) — bottom-anchored.
  parts.push(
    `^FO${LEFT},${FOOTER_Y}^A0N,${H_FOOT},${H_FOOT}^FD${escapeZpl(cupFrac)}^FS`,
  );
  parts.push(
    `^FO${LEFT},${FOOTER_Y}^A0N,${H_FOOT},${H_FOOT}^FB${W},1,0,R,0^FD$${escapeZpl(dollars)}^FS`,
  );

  parts.push("^XZ");
  return parts.join("\n");
}

// Escape characters that have special meaning in ZPL (^ ~ \ caret, tilde,
// backslash). If any of these appear in drink/modifier names they'd break
// parsing on the printer. Replace with ASCII-safe equivalents.
function escapeZpl(s: string): string {
  return s.replace(/\\/g, "/").replace(/\^/g, "-").replace(/~/g, "-");
}
