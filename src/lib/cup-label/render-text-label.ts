import "server-only";
import { renderSvgToPng } from "../doodle/render-svg";
import {
  formatPickupStamp,
  wrapModifierLine,
  type CupLabelInput,
  type CupLabelOutput,
} from "./render-zebra-cup";
import { NOTE_PREFIX, sanitizeLabelNote } from "./label-note";

// 40mm × 30mm direct-thermal label on the 300 DPI ZD410 — the temporary
// small-paper mode (see label-mode.ts). At 300 DPI ≈ 11.8 dots/mm:
// 40mm ≈ 472 dots (conveniently a multiple of 8), 30mm ≈ 354 dots.
//
// No room for doodle/photo raster art at this size, so the label is
// text-only and everything is sized UP relative to the 50×80 photo
// layout: the ticket number is the hero (80-dot font vs the old 46),
// the drink name runs up to 64, modifiers 34 (vs 32).
//
// Layout (dots):
//   • Top band (108): black bar. Ticket number left (white, huge).
//     Right column: cup fraction, plus "PU 5:45pm" stacked underneath
//     for a scheduled pickup.
//   • Body: drink name (≤2 lines, large) then the modifier list placed
//     directly under the name's actual line count, ending ≥24 dots above
//     the label bottom. The customer's note ("Note: …") rides under the
//     modifiers as one more group. The font adapts 34→28→24 so topping-
//     heavy orders print in full before any ellipsis; being last, the
//     note is what ellipsizes first. Keepsake copies omit all of it,
//     mirroring the photo layout's contract.
export const TEXT_LABEL_WIDTH_DOTS = 472;
export const TEXT_LABEL_HEIGHT_DOTS = 354;

const TOP_BAND_HEIGHT = 108;
const PAD_X = 16;
const INNER_WIDTH = TEXT_LABEL_WIDTH_DOTS - PAD_X * 2;

// Ticket number — the single most important field on the label.
const STICKER_Y = 14;
function stickerFontSizeFor(text: string): number {
  return text.length <= 5 ? 80 : 60;
}

// Right column of the top band (cup fraction / pickup time).
const TOP_RIGHT_X = 240;
const TOP_RIGHT_WIDTH = TEXT_LABEL_WIDTH_DOTS - TOP_RIGHT_X - PAD_X;
const TOP_RIGHT_FONT = 40;
const FRAC_ONE_LINE_Y = 34;
const FRAC_TWO_LINE_Y = 10;
const PICKUP_Y = 58;

// Drink name block. drinkFontSizeFor picks the natural size for the name;
// layoutBody may step further down DRINK_FONTS when a note-heavy order needs
// the rows (a smaller drink name beats a dropped sugar level or note).
const DRINK_Y = 120;
const DRINK_FONTS = [64, 52, 44, 36, 30];
function drinkFontSizeFor(name: string): number {
  const len = name.length;
  if (len <= 10) return 64;
  if (len <= 14) return 52;
  if (len <= 18) return 44;
  if (len <= 26) return 36;
  return 30;
}

// Estimated line count for the drink name at its chosen font, using the
// same 0.55 char-width heuristic that calibrates MOD_MAX_CHARS. The ^FB
// block allows 2 lines; only the 36/30-dot tiers can actually wrap.
function drinkLineCountFor(name: string, font: number): number {
  const charsPerLine = Math.floor(INNER_WIDTH / (0.55 * font));
  return name.length <= charsPerLine ? 1 : 2;
}

// Modifier block. Y is dynamic — directly under however many lines the
// drink name takes — so a one-line name doesn't push modifiers toward
// the label bottom. All content must end BOTTOM_MARGIN above the label
// edge so ordinary tear-off / calibration drift can't clip it (the
// original fixed Y=238 left only 8 dots and clipped in production).
//
// The font is adaptive: 34 dots normally, stepping down 34→28→24 when a
// topping-heavy order needs more lines than fit at the current size.
// chars/line per tier scales from the field-calibrated 22 @ 34 dots
// (0.55 char-width heuristic, same as the photo layout). Only when even
// 24-dot can't hold everything does the last line ellipsize.
const MOD_GAP = 16;
const MOD_LINE_SPACING = 2;
const BOTTOM_MARGIN = 24;
const BOTTOM_LIMIT = TEXT_LABEL_HEIGHT_DOTS - BOTTOM_MARGIN;
const MOD_TIERS = [34, 28, 24].map((font) => ({
  font,
  chars: Math.floor((22 * 34) / font),
}));

function modYFor(drinkName: string, font: number): number {
  return DRINK_Y + drinkLineCountFor(drinkName, font) * font + MOD_GAP;
}

function maxModLinesFor(modY: number, font: number): number {
  return Math.max(1, Math.floor((BOTTOM_LIMIT - modY) / (font + MOD_LINE_SPACING)));
}

function capModLines(lines: string[], maxLines: number, maxChars: number): string[] {
  if (lines.length <= maxLines) return lines;
  const out = lines.slice(0, maxLines);
  const last = out[maxLines - 1];
  out[maxLines - 1] =
    last.length > maxChars - 1 ? last.slice(0, maxChars - 1) + "…" : last + " …";
  return out;
}

type BodyLines = { font: number; lines: string[] };

/** The largest modifier font whose wrapped rows fit between `modY` and the
 *  bottom margin, or null when even the smallest tier overflows. */
function fitModifiers(text: string, modY: number): BodyLines | null {
  for (const tier of MOD_TIERS) {
    const lines = wrapModifierLine(text, tier.chars, Number.POSITIVE_INFINITY);
    if (lines.length <= maxModLinesFor(modY, tier.font)) return { font: tier.font, lines };
  }
  return null;
}

/** Like fitModifiers, but ellipsizes at the smallest tier instead of giving up. */
function layoutModifiers(text: string, modY: number): BodyLines {
  const fitted = fitModifiers(text, modY);
  if (fitted) return fitted;
  const tier = MOD_TIERS[MOD_TIERS.length - 1];
  return {
    font: tier.font,
    lines: capModLines(
      wrapModifierLine(text, tier.chars, Number.POSITIVE_INFINITY),
      maxModLinesFor(modY, tier.font),
      tier.chars,
    ),
  };
}

type BodyLayout = { drinkFont: number; modY: number; mods: BodyLines };

/**
 * Drink name + body (modifier groups, then the note). Tries the natural
 * drink font first; when no modifier tier can hold the body in full, steps
 * the drink font down DRINK_FONTS to free rows, and only ellipsizes (at the
 * smallest drink font and modifier tier) when nothing else fits — the body
 * is ordered so the note, not a modifier, is what gets cut.
 */
function layoutBody(drinkName: string, bodyText: string): BodyLayout {
  const natural = drinkFontSizeFor(drinkName);
  const fonts = DRINK_FONTS.filter((f) => f <= natural);
  if (bodyText.length === 0) {
    return { drinkFont: natural, modY: modYFor(drinkName, natural), mods: { font: MOD_TIERS[0].font, lines: [] } };
  }
  for (const drinkFont of fonts) {
    const modY = modYFor(drinkName, drinkFont);
    const mods = fitModifiers(bodyText, modY);
    if (mods) return { drinkFont, modY, mods };
  }
  const drinkFont = fonts[fonts.length - 1];
  const modY = modYFor(drinkName, drinkFont);
  return { drinkFont, modY, mods: layoutModifiers(bodyText, modY) };
}

function escapeZpl(s: string): string {
  return s.replace(/\\/g, "/").replace(/\^/g, "-").replace(/~/g, "-");
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
}

/**
 * Text-only 40×30mm label. Accepts the same input shape as the photo
 * renderer so enqueue/admin callers don't change — doodle / fortune
 * fields are simply ignored (nothing raster fits on this paper).
 */
export async function renderTextCupLabel(input: CupLabelInput): Promise<CupLabelOutput> {
  const frac = `${input.cupIdxOf.idx}/${input.cupIdxOf.total}`;
  const pickupStamp = formatPickupStamp(input.pickupAt);
  const sticker = input.stickerNumber;
  const stickerFont = stickerFontSizeFor(sticker);
  // The note joins the modifier groups as the last one, so the same
  // 34→28→24 font search (plus stepping the drink name down) keeps
  // everything on the label, and it is the note, not a modifier, that
  // ellipsizes if even the smallest sizes cannot hold it all.
  const note = input.keepsake ? "" : sanitizeLabelNote(input.customerNote);
  const bodyText = [input.modifiersText, note ? `${NOTE_PREFIX}${note}` : ""]
    .filter((s) => s.length > 0)
    .join("\n");
  const { drinkFont, modY, mods } = layoutBody(input.drinkName, bodyText);

  const parts: string[] = [];
  parts.push("^XA");
  parts.push(`^PW${TEXT_LABEL_WIDTH_DOTS}`);
  parts.push(`^LL${TEXT_LABEL_HEIGHT_DOTS}`);
  parts.push("^CI28"); // UTF-8
  parts.push("^PR4");
  parts.push("^LH0,0");
  // The ZD410 keeps ^LT (label top) in NVRAM across rolls — a stale
  // offset from the 50x80 photo roll shifts this 30mm print down and
  // clips the bottom. Pin it to 0 in every format.
  parts.push("^LT0");

  // Top band: solid black bar, white (^FR) text.
  parts.push(`^FO0,0^GB${TEXT_LABEL_WIDTH_DOTS},${TOP_BAND_HEIGHT},${TOP_BAND_HEIGHT}^FS`);
  parts.push(
    `^FO${PAD_X},${STICKER_Y}^A0N,${stickerFont},${stickerFont}^FR^FB${TOP_RIGHT_X - PAD_X},1,0,L,0^FD${escapeZpl(sticker)}^FS`,
  );
  if (pickupStamp) {
    parts.push(
      `^FO${TOP_RIGHT_X},${FRAC_TWO_LINE_Y}^A0N,${TOP_RIGHT_FONT},${TOP_RIGHT_FONT}^FR^FB${TOP_RIGHT_WIDTH},1,0,R,0^FD${escapeZpl(frac)}^FS`,
    );
    parts.push(
      `^FO${TOP_RIGHT_X},${PICKUP_Y}^A0N,${TOP_RIGHT_FONT},${TOP_RIGHT_FONT}^FR^FB${TOP_RIGHT_WIDTH},1,0,R,0^FD${escapeZpl(pickupStamp)}^FS`,
    );
  } else {
    parts.push(
      `^FO${TOP_RIGHT_X},${FRAC_ONE_LINE_Y}^A0N,${TOP_RIGHT_FONT},${TOP_RIGHT_FONT}^FR^FB${TOP_RIGHT_WIDTH},1,0,R,0^FD${escapeZpl(frac)}^FS`,
    );
  }

  // Body: drink name + modifiers. Keepsake copies omit both (same
  // contract as the photo layout).
  if (!input.keepsake) {
    parts.push(
      `^FO${PAD_X},${DRINK_Y}^A0N,${drinkFont},${drinkFont}^FB${INNER_WIDTH},2,0,L,0^FD${escapeZpl(input.drinkName)}^FS`,
    );
    if (mods.lines.length > 0) {
      parts.push(
        `^FO${PAD_X},${modY}^A0N,${mods.font},${mods.font}^FB${INNER_WIDTH},${mods.lines.length},${MOD_LINE_SPACING},L,0^FD${mods.lines.map(escapeZpl).join("\\&")}^FS`,
      );
    }
  }

  parts.push("^XZ");
  const zpl = parts.join("\n");
  const previewPng = await renderPreviewPng(input, { frac, pickupStamp, drinkFont, modY, mods });
  return { zpl, previewPng };
}

// Dev/admin eyeball preview mirroring the ZPL layout.
async function renderPreviewPng(
  input: CupLabelInput,
  d: { frac: string; pickupStamp: string; drinkFont: number; modY: number; mods: BodyLines },
): Promise<Buffer> {
  const stickerFont = stickerFontSizeFor(input.stickerNumber);
  const rightEdge = TEXT_LABEL_WIDTH_DOTS - PAD_X;
  const rightCol = d.pickupStamp
    ? `<text x="${rightEdge}" y="${FRAC_TWO_LINE_Y + TOP_RIGHT_FONT}" text-anchor="end" font-family="sans-serif" font-size="${TOP_RIGHT_FONT}" font-weight="700" fill="white">${escapeXml(d.frac)}</text>
       <text x="${rightEdge}" y="${PICKUP_Y + TOP_RIGHT_FONT}" text-anchor="end" font-family="sans-serif" font-size="${TOP_RIGHT_FONT}" font-weight="700" fill="white">${escapeXml(d.pickupStamp)}</text>`
    : `<text x="${rightEdge}" y="${FRAC_ONE_LINE_Y + TOP_RIGHT_FONT}" text-anchor="end" font-family="sans-serif" font-size="${TOP_RIGHT_FONT}" font-weight="700" fill="white">${escapeXml(d.frac)}</text>`;

  let body = "";
  if (!input.keepsake) {
    body += `<text x="${PAD_X}" y="${DRINK_Y + d.drinkFont}" font-family="sans-serif" font-size="${d.drinkFont}" font-weight="700" fill="black">${escapeXml(input.drinkName)}</text>`;
    body += d.mods.lines
      .map(
        (line, i) =>
          `<text x="${PAD_X}" y="${d.modY + d.mods.font + i * (d.mods.font + MOD_LINE_SPACING)}" font-family="sans-serif" font-size="${d.mods.font}" fill="black">${escapeXml(line)}</text>`,
      )
      .join("");
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${TEXT_LABEL_WIDTH_DOTS}" height="${TEXT_LABEL_HEIGHT_DOTS}">
    <rect width="100%" height="100%" fill="white"/>
    <rect width="100%" height="${TOP_BAND_HEIGHT}" fill="black"/>
    <text x="${PAD_X}" y="${STICKER_Y + stickerFont}" font-family="sans-serif" font-size="${stickerFont}" font-weight="700" fill="white">${escapeXml(input.stickerNumber)}</text>
    ${rightCol}
    ${body}
  </svg>`;
  return renderSvgToPng(svg, {
    widthPx: TEXT_LABEL_WIDTH_DOTS,
    heightPx: TEXT_LABEL_HEIGHT_DOTS,
  });
}
