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
 * Label: 50 mm wide x 30 mm tall -> 400 x 240 dots.
 *
 * Layout (top to bottom):
 *   1. Order number (left, large) + time (right, medium)
 *   2. Drink name (medium, auto-wrap)
 *   3. Toppings -> Ice -> Sugar (small, auto-wrap)
 *   4. Cup index/total (left) + price (right)
 */
export function renderStickerZPL(cup: CupForZPL): string {
  const dollars = (cup.priceCents / 100).toFixed(2);
  const cupFrac = `${cup.cupIndex}/${cup.cupTotal}`;
  const toppings = cup.toppings.length > 0 ? cup.toppings.join("+") : "";
  const ice = cup.ice ?? "";
  const sugar = cup.sugar ?? "";
  const modifierLine = `${toppings} -> ${ice} -> ${sugar}`.trim();

  // Font sizes (dots). Font 0 is scalable height x width.
  const H_NUM = 45;     // order number
  const H_TIME = 32;    // time
  const H_DRINK = 30;   // drink name
  const H_MOD = 24;     // modifier line
  const H_FOOT = 26;    // footer

  // Vertical cursor. Leave 10 dots padding top.
  let y = 10;

  const parts: string[] = [];
  parts.push("^XA");           // start
  parts.push("^PW400");        // print width (50mm @ 203dpi)
  parts.push("^LL240");        // label length (30mm @ 203dpi)
  parts.push("^CI28");         // UTF-8

  // Row 1: sticker number (left) + time (right, top-right)
  parts.push(`^FO15,${y}^A0N,${H_NUM},${H_NUM}^FD${escapeZpl(cup.stickerNumber)}^FS`);
  parts.push(`^FO270,${y + 10}^A0N,${H_TIME},${H_TIME}^FD${escapeZpl(cup.orderTime)}^FS`);
  y += H_NUM + 6;

  // Row 2: drink name, auto-wrap up to 2 lines at ~22 chars per line
  parts.push(
    `^FO15,${y}^A0N,${H_DRINK},${H_DRINK}^FB370,2,4,L,0^FD${escapeZpl(cup.drinkName)}^FS`,
  );
  y += H_DRINK * 2 + 4;

  // Row 3: modifiers, auto-wrap up to 2 lines
  parts.push(
    `^FO15,${y}^A0N,${H_MOD},${H_MOD}^FB370,2,2,L,0^FD${escapeZpl(modifierLine)}^FS`,
  );
  y += H_MOD * 2 + 4;

  // Row 4: cup fraction (left) + price (right)
  parts.push(`^FO15,${y}^A0N,${H_FOOT},${H_FOOT}^FD${escapeZpl(cupFrac)}^FS`);
  parts.push(`^FO280,${y}^A0N,${H_FOOT},${H_FOOT}^FD$${escapeZpl(dollars)}^FS`);

  parts.push("^XZ");           // end
  return parts.join("\n");
}

// Escape characters that have special meaning in ZPL (^ ~ \ caret, tilde,
// backslash). If any of these appear in drink/modifier names they'd break
// parsing on the printer. Replace with ASCII-safe equivalents.
function escapeZpl(s: string): string {
  return s.replace(/\\/g, "/").replace(/\^/g, "-").replace(/~/g, "-");
}
