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
// Drink font H=28 at ~19 chars/line -> 2 lines ~ 38 chars.
const MAX_DRINK_CHARS = 38;
// Threshold that flips the drink row from 1-line to 2-line allotment.
// Names up to 22 chars fit a single line at H_DRINK=28 on the ZD411's
// condensed font, freeing a full H_DRINK row of vertical space for the
// modifier block below (up to 5 wrapped lines instead of 4).
const DRINK_ONE_LINE_THRESHOLD = 22;
// Modifier cap depends on how many wrap lines we can use. At H_MOD=22
// on the ZD411's condensed font each line holds ~20 chars (narrower
// than Labelary previews suggest). Capping below the ^FB hard-clip
// threshold keeps overflow from overprinting the last line — anything
// over gets a clean "…" rather than "(75%)" stacked on top.
//   5 lines (short drink, 1-line budget)  -> ~100 char ceiling
//   4 lines (long drink, 2-line budget)   -> ~80 char ceiling
const MAX_MOD_CHARS_5LINE = 100;
const MAX_MOD_CHARS_4LINE = 80;
// Empirical character width for the modifier font on a real ZD411; used
// to compute how many wrap lines the text actually needs so the footer
// can tuck in right below rather than bottom-anchoring with a dead gap.
const CHARS_PER_MOD_LINE = 20;

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// Default modifier levels (ICE / SUGAR / ALTERNATIVE MILK lists) that
// should NOT print on the sticker. Staff assumes default unless the
// label says otherwise. Matches "Normal Ice", "Standard Sugar", and
// "Standard(Recommended)" milk.
function isDefaultLevel(v: string | null | undefined): boolean {
  if (!v) return false;
  return /^\s*(normal|standard)\b/i.test(v);
}

// Closed-set abbreviation tables keyed on lowercased Square modifier
// name. Unknown values return the input trimmed (fail-safe: prints the
// full name rather than a potentially-wrong abbreviation).
const ICE_ABBREVS: Record<string, string> = {
  "less ice": "L.Ice",
  "extra ice": "E.Ice",
  "no ice": "N.Ice",
  "warm": "Warm",
};

// Sugar uses percentage form since Square uses parenthesised percentages
// ("Less Sugar (75%)" / "Little Sugar (25%)") that would otherwise
// collide with a letter-first abbreviation ("L.Sugar" could be either).
const SUGAR_ABBREVS: Record<string, string> = {
  "less sugar (75%)": "75%S",
  "less sugar 75%": "75%S",
  "less sugar": "75%S",
  "half sugar": "50%S",
  "little sugar (25%)": "25%S",
  "little sugar 25%": "25%S",
  "little sugar": "25%S",
  "no sugar": "0%S",
  "extra sugar": "+S",
};

function abbreviateIce(v: string | null | undefined): string {
  if (!v) return "";
  const key = v.trim().toLowerCase().replace(/\s+/g, " ");
  return ICE_ABBREVS[key] ?? v.trim();
}

function abbreviateSugar(v: string | null | undefined): string {
  if (!v) return "";
  const key = v.trim().toLowerCase().replace(/\s+/g, " ");
  return SUGAR_ABBREVS[key] ?? v.trim();
}

export function renderStickerZPL(cup: CupForZPL): string {
  const dollars = (cup.priceCents / 100).toFixed(2);
  const cupFrac = `${cup.cupIndex}/${cup.cupTotal}`;
  const toppings = cup.toppings.length > 0 ? cup.toppings.join("+") : "";
  // Defaults ("Normal Ice", "Standard Sugar") are omitted — staff assumes
  // default unless stated otherwise. Non-default values get compact
  // shorthand from a closed-set table so the modifier row stays under
  // MAX_MOD_CHARS for realistic orders.
  const ice = isDefaultLevel(cup.ice) ? "" : abbreviateIce(cup.ice);
  const sugar = isDefaultLevel(cup.sugar) ? "" : abbreviateSugar(cup.sugar);
  const drinkName = truncate(cup.drinkName, MAX_DRINK_CHARS);
  // Modifier truncation cap scales with available wrap lines, which is
  // in turn determined by drinkName length (short name = 1-line budget
  // = 5 mod lines; long name = 2-line budget = 4 mod lines).
  const modCap =
    drinkName.length > DRINK_ONE_LINE_THRESHOLD
      ? MAX_MOD_CHARS_4LINE
      : MAX_MOD_CHARS_5LINE;
  const modifierLine = truncate(
    [toppings, ice, sugar].filter((s) => s.length > 0).join(" -> "),
    modCap,
  );

  // Label geometry (40x30mm @ 203dpi).
  const PW = 320;
  const LL = 240;
  const LEFT = 15;
  const RIGHT_PAD = 15;
  const W = PW - LEFT - RIGHT_PAD; // usable width for wrap/right-align
  const TOP = 2;
  // Bottom margin: the Zebra's usable print window ends a few mm
  // above the label's physical edge. 30 dots ≈ 3.75 mm — enough to
  // keep the footer inside the print window even when top-of-form
  // drift or gap-sensor slop nudges the whole label down.
  const BOTTOM = 30;
  const ROW_GAP = 2;

  // Font heights in dots (font 0, scalable). Sized so tea-making staff
  // can read drink / modifier / cup count at a glance without squinting,
  // while still fitting the worst-case extreme order (long drink name
  // + alternative milk + 3 max-count toppings + non-default ice+sugar).
  // H_NUM shrunk to 32 (from 38) so the sticker# no longer dominates
  // vertical space that the tea-maker cares less about than drink name.
  const H_NUM = 32;
  const H_TIME = 22;
  const H_DRINK = 28;
  const H_MOD = 22;
  const H_FOOT = 26;

  // Upper bound for the footer's Y. Footer normally flows right below
  // the modifier row; FOOTER_Y_MAX is the clamp that keeps it out of
  // the printer's bottom dead zone when the body has enough content
  // to push against it.
  const FOOTER_Y_MAX = LL - BOTTOM - H_FOOT;

  let y = TOP;

  const parts: string[] = [];
  parts.push("^XA");
  parts.push(`^PW${PW}`);
  parts.push(`^LL${LL}`);
  parts.push("^PR6");          // print speed: 6 ips (ZD411 max)
  parts.push("^CI28");         // UTF-8

  // Row 1: sticker number (left, big) + time (right, smaller, vertically centered-ish)
  parts.push(
    `^FO${LEFT},${y}^A0N,${H_NUM},${H_NUM}^FD${escapeZpl(cup.stickerNumber)}^FS`,
  );
  parts.push(
    `^FO${LEFT},${y + (H_NUM - H_TIME) / 2}^A0N,${H_TIME},${H_TIME}^FB${W},1,0,R,0^FD${escapeZpl(cup.orderTime)}^FS`,
  );
  y += H_NUM + ROW_GAP;

  // Row 2: drink name — allot 1 line for short names and 2 lines for
  // longer names. Reclaiming a full H_DRINK row for short names gives
  // the modifier block below a fifth wrap line, which matters for
  // extreme orders (alt milk + 3 max-count toppings + non-default
  // ice+sugar). No ROW_GAP before the modifier row — the space already
  // built into ZPL font 0's ascent handles visual separation.
  const drinkLines = drinkName.length > DRINK_ONE_LINE_THRESHOLD ? 2 : 1;
  parts.push(
    `^FO${LEFT},${y}^A0N,${H_DRINK},${H_DRINK}^FB${W},${drinkLines},2,L,0^FD${escapeZpl(drinkName)}^FS`,
  );
  y += H_DRINK * drinkLines;

  // Row 3: modifiers — allocate only as many wrap lines as the text
  // actually needs so short orders don't leave a dead strip between
  // the body and the footer. Cap by both content length (5 lines max)
  // and available vertical space before the footer's clamp.
  const neededModLines = modifierLine.length > 0
    ? Math.max(1, Math.ceil(modifierLine.length / CHARS_PER_MOD_LINE))
    : 0;
  const availableModLines = Math.max(
    1,
    Math.floor((FOOTER_Y_MAX - ROW_GAP - y) / H_MOD),
  );
  const modLines = modifierLine.length > 0
    ? Math.min(neededModLines, availableModLines, 5)
    : 0;
  if (modLines > 0) {
    parts.push(
      `^FO${LEFT},${y}^A0N,${H_MOD},${H_MOD}^FB${W},${modLines},2,L,0^FD${escapeZpl(modifierLine)}^FS`,
    );
    y += H_MOD * modLines + ROW_GAP;
  }

  // Row 4: footer tucks in right below the body. FOOTER_Y_MAX clamps it
  // so a very long modifier block can't push cup-count + price out of
  // the printer's safe print window.
  const footerY = Math.min(y, FOOTER_Y_MAX);
  parts.push(
    `^FO${LEFT},${footerY}^A0N,${H_FOOT},${H_FOOT}^FD${escapeZpl(cupFrac)}^FS`,
  );
  parts.push(
    `^FO${LEFT},${footerY}^A0N,${H_FOOT},${H_FOOT}^FB${W},1,0,R,0^FD$${escapeZpl(dollars)}^FS`,
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
