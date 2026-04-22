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
 */
export function renderStickerZPL(cup: CupForZPL): string {
  const dollars = (cup.priceCents / 100).toFixed(2);
  const cupFrac = `${cup.cupIndex}/${cup.cupTotal}`;
  const toppings = cup.toppings.length > 0 ? cup.toppings.join("+") : "";
  const ice = cup.ice ?? "";
  const sugar = cup.sugar ?? "";
  const modifierLine = `${toppings} -> ${ice} -> ${sugar}`.trim();

  // Label geometry (40x30mm @ 203dpi).
  const PW = 320;
  const LL = 240;
  const LEFT = 15;
  const RIGHT_PAD = 15;
  const W = PW - LEFT - RIGHT_PAD; // usable width for wrap/right-align

  // Font heights in dots (font 0, scalable).
  const H_NUM = 40;
  const H_TIME = 24;
  const H_DRINK = 26;
  const H_MOD = 22;
  const H_FOOT = 24;

  let y = 8;

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
  y += H_NUM + 4;

  // Row 2: drink name, wrap up to 2 lines
  parts.push(
    `^FO${LEFT},${y}^A0N,${H_DRINK},${H_DRINK}^FB${W},2,3,L,0^FD${escapeZpl(cup.drinkName)}^FS`,
  );
  y += H_DRINK * 2 + 2;

  // Row 3: modifiers, wrap up to 2 lines
  parts.push(
    `^FO${LEFT},${y}^A0N,${H_MOD},${H_MOD}^FB${W},2,2,L,0^FD${escapeZpl(modifierLine)}^FS`,
  );
  y += H_MOD * 2 + 2;

  // Row 4: cup fraction (left) + price (right)
  parts.push(
    `^FO${LEFT},${y}^A0N,${H_FOOT},${H_FOOT}^FD${escapeZpl(cupFrac)}^FS`,
  );
  parts.push(
    `^FO${LEFT},${y}^A0N,${H_FOOT},${H_FOOT}^FB${W},1,0,R,0^FD$${escapeZpl(dollars)}^FS`,
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
