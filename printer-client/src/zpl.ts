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
 * The footer (row 4) is bottom-anchored so price+cup-count always
 * print even if the drink/modifier rows need extra space.
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
  // on the label regardless of how tall the rows above end up.
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
