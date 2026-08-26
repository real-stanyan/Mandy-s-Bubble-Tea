import "server-only";
import { renderSvgToPng } from "../doodle/render-svg";
import {
  formatPickupStamp,
  wrapModifierLine,
  type CupLabelInput,
  type CupLabelOutput,
} from "./render-zebra-cup";

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
//   • Body: drink name (≤2 lines, large) then modifier list (≤3 lines).
//     Keepsake copies omit both, mirroring the photo layout's contract.
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

// Drink name block.
const DRINK_Y = 120;
function drinkFontSizeFor(name: string): number {
  const len = name.length;
  if (len <= 10) return 64;
  if (len <= 14) return 52;
  if (len <= 18) return 44;
  if (len <= 26) return 36;
  return 30;
}

// Modifier block. 22 chars/line at 34-dot font across the 440-dot inner
// width (0.55 char-width heuristic, same calibration as the photo layout).
const MOD_Y = 238;
const MOD_FONT = 34;
const MOD_LINE_SPACING = 2;
const MOD_MAX_CHARS = 22;
const MOD_MAX_LINES = 3;

function capModLines(lines: string[]): string[] {
  if (lines.length <= MOD_MAX_LINES) return lines;
  const out = lines.slice(0, MOD_MAX_LINES);
  const last = out[MOD_MAX_LINES - 1];
  out[MOD_MAX_LINES - 1] =
    last.length > MOD_MAX_CHARS - 1 ? last.slice(0, MOD_MAX_CHARS - 1) + "…" : last + " …";
  return out;
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
  const modLines =
    input.modifiersText.length > 0
      ? capModLines(wrapModifierLine(input.modifiersText, MOD_MAX_CHARS))
      : [];

  const parts: string[] = [];
  parts.push("^XA");
  parts.push(`^PW${TEXT_LABEL_WIDTH_DOTS}`);
  parts.push(`^LL${TEXT_LABEL_HEIGHT_DOTS}`);
  parts.push("^CI28"); // UTF-8
  parts.push("^PR4");
  parts.push("^LH0,0");

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
    const drinkFont = drinkFontSizeFor(input.drinkName);
    parts.push(
      `^FO${PAD_X},${DRINK_Y}^A0N,${drinkFont},${drinkFont}^FB${INNER_WIDTH},2,0,L,0^FD${escapeZpl(input.drinkName)}^FS`,
    );
    if (modLines.length > 0) {
      parts.push(
        `^FO${PAD_X},${MOD_Y}^A0N,${MOD_FONT},${MOD_FONT}^FB${INNER_WIDTH},${modLines.length},${MOD_LINE_SPACING},L,0^FD${modLines.map(escapeZpl).join("\\&")}^FS`,
      );
    }
  }

  parts.push("^XZ");
  const zpl = parts.join("\n");
  const previewPng = await renderPreviewPng(input, { frac, pickupStamp, modLines });
  return { zpl, previewPng };
}

// Dev/admin eyeball preview mirroring the ZPL layout.
async function renderPreviewPng(
  input: CupLabelInput,
  d: { frac: string; pickupStamp: string; modLines: string[] },
): Promise<Buffer> {
  const stickerFont = stickerFontSizeFor(input.stickerNumber);
  const rightEdge = TEXT_LABEL_WIDTH_DOTS - PAD_X;
  const rightCol = d.pickupStamp
    ? `<text x="${rightEdge}" y="${FRAC_TWO_LINE_Y + TOP_RIGHT_FONT}" text-anchor="end" font-family="sans-serif" font-size="${TOP_RIGHT_FONT}" font-weight="700" fill="white">${escapeXml(d.frac)}</text>
       <text x="${rightEdge}" y="${PICKUP_Y + TOP_RIGHT_FONT}" text-anchor="end" font-family="sans-serif" font-size="${TOP_RIGHT_FONT}" font-weight="700" fill="white">${escapeXml(d.pickupStamp)}</text>`
    : `<text x="${rightEdge}" y="${FRAC_ONE_LINE_Y + TOP_RIGHT_FONT}" text-anchor="end" font-family="sans-serif" font-size="${TOP_RIGHT_FONT}" font-weight="700" fill="white">${escapeXml(d.frac)}</text>`;

  let body = "";
  if (!input.keepsake) {
    const drinkFont = drinkFontSizeFor(input.drinkName);
    body += `<text x="${PAD_X}" y="${DRINK_Y + drinkFont}" font-family="sans-serif" font-size="${drinkFont}" font-weight="700" fill="black">${escapeXml(input.drinkName)}</text>`;
    body += d.modLines
      .map(
        (line, i) =>
          `<text x="${PAD_X}" y="${MOD_Y + MOD_FONT + i * (MOD_FONT + MOD_LINE_SPACING)}" font-family="sans-serif" font-size="${MOD_FONT}" fill="black">${escapeXml(line)}</text>`,
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
