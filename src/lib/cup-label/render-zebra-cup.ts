import "server-only";
import sharp from "sharp";
import { renderSvgToPng } from "../doodle/render-svg";
import { brisbaneClockLabel } from "../pickup-schedule";
import {
  getMandyLogoZpl,
  MANDY_LOGO_HEIGHT,
  MANDY_LOGO_WIDTH,
} from "./mandy-logo";
import { NOTE_PREFIX, sanitizeLabelNote } from "./label-note";

// 50mm × 80mm direct-thermal cup label printed on a 300 DPI Zebra
// (ZD410-300dpi). At 300 DPI: 25.4mm/inch ÷ 300 dots/inch ≈ 0.0847mm/dot,
// so 50mm = 590 dots and 80mm = 945 dots. The width is rounded down to a
// multiple of 8 for byte-aligned 1-bit raster packing (588 = 73.5
// bytes/row → use 584 = 73 bytes/row for safety) — actually the printer
// doesn't require width-byte alignment for non-graphic regions, only the
// embedded ^GFA needs an 8-aligned width. Height extra above the prior
// 70mm (827 dots) flows into the bottom modifier band via BOTTOM_BAND_HEIGHT.
export const LABEL_WIDTH_DOTS = 590;
export const LABEL_HEIGHT_DOTS = 945;

// Sandwich layout (top → middle → bottom):
//   • Top    (10mm = 120 dots): black band, white sticker number + cup
//                                fraction (line 1) + drink name (line 2).
//   • Middle (~49.5mm = 584 dots): user/preset doodle, square, near-edge-
//                                  to-edge (3 dots ≈ 0.25mm padding left
//                                  and right — the 8-dot byte alignment
//                                  required by ZPL ^GFA forces us off
//                                  the 590-dot label width by 6 dots).
//   • Bottom (~19.6mm = remainder): modifier text in zebra format
//                                 (Pearls(2)+Pudding -> L.Ice -> 50%S).
// Top band: just greeting + sticker fraction. Drink name AND modifier
// list both live in the bottom band (2026-05-22 layout — Stan wants the
// front of the cup, post-flip, to carry all the prep info: drink + mods).
const TOP_BAND_HEIGHT = 90;
// Two-column top band: greeting on the left, order info on the right.
// Greeting sits at the standard left padding. The right column now holds
// just the sticker/cup-fraction line (drink name moved to bottom band
// 2026-05-22 for full-width readability). Width budget restored.
const TOP_GREETING_X = 20;
const TOP_GREETING_Y = 28;
const TOP_GREETING_WIDTH = 220;

function greetingFontSizeFor(text: string): number {
  const len = text.length;
  if (len <= 8) return 42;   // "Hi, Stan"  8 chars
  if (len <= 10) return 36;  // "Hi, Mandy"  9
  if (len <= 13) return 30;  // "Hi, Christine" 13
  return 24;                 // longer names
}
const TOP_RIGHT_X = 250;
const TOP_RIGHT_WIDTH = LABEL_WIDTH_DOTS - TOP_RIGHT_X - 20;
// Both top-row elements vertically centered in the 90-dot black band.
// For ZPL ^A0N: text top sits at ^FO y. Center for largest font (46pt
// sticker): y = (90-46)/2 = 22. Greeting font scales (42/36/30/24); we
// use the 42pt center y=24, smaller fonts sit slightly above-center but
// the visual difference is within ~9 dots.
const TOP_STICKER_Y = 22;
// Scheduled pickup only: the right column carries a second line ("PU 5:45pm")
// under the sticker number, so both drop to 36pt to fit the 90-dot band —
// line 1 spans y 6..42, line 2 y 48..84. An ASAP order never takes this
// branch and its label stays dot-for-dot what it was.
const TOP_RIGHT_TWO_LINE_FONT = 36;
const TOP_STICKER_TWO_LINE_Y = 6;
const TOP_PICKUP_Y = 48;
// (Modifier list now lives in the bottom band — see BOTTOM_MODIFIER_Y_REL.)

// Drink name now lives in the bottom band (full-width, large) — see
// renderTopBand / renderBottomBand below. drinkFontSizeFor sizes for
// the full label inner width (LABEL_WIDTH - 40 padding - logo width
// reservation ≈ 480 dots), so short names print big.
function drinkFontSizeFor(name: string): number {
  const len = name.length;
  if (len <= 14) return 60;
  if (len <= 18) return 50;
  if (len <= 22) return 42;
  if (len <= 27) return 34;
  return 28;
}

// Mandy logo now lives in the bottom-right corner of the white bottom
// band (modifier text region). Rendered without ^FR — bottom band is
// white so the pre-binarised logo's print-bits paint as black ink
// directly. Reserved area: ~88×100 starting (LABEL_WIDTH-88-6, LABEL_HEIGHT-100-6).
const LOGO_MARGIN = 6;
const LOGO_X = LABEL_WIDTH_DOTS - MANDY_LOGO_WIDTH - LOGO_MARGIN;
const LOGO_Y = LABEL_HEIGHT_DOTS - MANDY_LOGO_HEIGHT - LOGO_MARGIN;
// Doodle fills the label width edge-to-edge. ZPL ^GFA requires the raster
// width to be a multiple of 8 dots (byte-row alignment), but the 590-dot
// label width is not. We choose 592 (8×74) — 2 dots wider than the
// physical label — and left-align it at x=0. The trailing 2 dots fall
// off the right edge and are silently clipped by the print head, giving
// a perceived 0mm border on both sides (vs the previous 0.25mm each).
const DOODLE_SIZE = 592;
const DOODLE_LEFT = 0;
const MIDDLE_BAND_HEIGHT = DOODLE_SIZE;
// Fortune (POS path) text-block sizing. ~55-dot font ≈ 4.7mm cap-height
// at 300dpi — large enough to read across the counter, small enough
// that a 12-word fortune fits in 2 lines.
const FORTUNE_FONT_SIZE = 55;
const FORTUNE_LINE_SPACING = 18;
const FORTUNE_PADDING_X = 40;
const BAND_GAP = 10; // dot row gap between middle and bottom
export const BOTTOM_BAND_Y = TOP_BAND_HEIGHT + MIDDLE_BAND_HEIGHT + BAND_GAP;
export const BOTTOM_BAND_HEIGHT = LABEL_HEIGHT_DOTS - BOTTOM_BAND_Y;

export type CupLabelInput = {
  stickerNumber: string;
  cupIdxOf: { idx: number; total: number };
  drinkName: string;
  modifiersText: string;
  doodleSvg: string;
  /**
   * Optional pre-rendered doodle raster. When present, bypasses the
   * SVG→resvg pipeline and pipes this PNG straight into the grayscale +
   * threshold + 1-bit pack stages. Used by AI-generated doodles where
   * we already have a raster output from the upstream model and don't
   * want to round-trip through SVG. Must be square and resizable to
   * DOODLE_SIZE × DOODLE_SIZE.
   */
  doodlePngBuffer?: Buffer;
  /** Logged-in customer's first name. Falls back to "Soul" when null/empty/undefined. */
  customerFirstName?: string | null;
  /**
   * Keepsake copy: the extra label the customer keeps. Renders the same
   * greeting / order-number / cup-fraction / doodle / logo but OMITS the
   * drink name and modifier list (the "keep everything except drink +
   * mods" requirement). Defaults to false — every existing caller renders
   * the full label unchanged.
   */
  keepsake?: boolean;
  /**
   * Fortune-cookie-style sentence rendered in place of the middle
   * doodle band. Used by in-store (Square POS) orders where the
   * customer never touches the web/app and there is no drawn / preset
   * / AI / upload doodle to pick — see `lib/cup-label/fortune.ts` for
   * generation. When set, the SVG/PNG raster pipeline is skipped
   * entirely; the renderer emits a ZPL ^FB text block centered across
   * the same physical band. Plain ASCII English only — ZD410 stock
   * fonts can't render CJK without a separate font-download step.
   */
  fortuneText?: string;
  /**
   * The customer's chosen collection time, for a scheduled-pickup order.
   * Printed in the top band as "PU 5:45pm" — the counter's question about a
   * cup waiting on the bench is "when do they come for it". Null/undefined
   * (every ASAP order) prints the band exactly as before.
   */
  pickupAt?: Date | string | null;
  /**
   * The customer's "note for the barista" (web/app checkout, or a POS item
   * note — see label-note.ts for where it is read from and what the printer
   * font can carry). Printed in the bottom band under the modifier list as
   * "Note: …", with the whole band stepping its fonts down so the modifier
   * list still prints in full. Omitted on keepsake copies, like the rest of
   * the prep info.
   */
  customerNote?: string | null;
};

function formatGreeting(name: string | null): string {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? `Hi, ${trimmed}` : "Hi, Soul";
}

/** "PU 5:45pm" for a scheduled pickup, "" for an ASAP order (or an
 *  unparseable timestamp — a missing line beats a label reading "PU NaN"). */
export function formatPickupStamp(at: Date | string | null | undefined): string {
  if (!at) return "";
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return `PU ${brisbaneClockLabel(d)}`;
}

export type CupLabelOutput = {
  /** ZPL II string ready to send to a 300 DPI Zebra. */
  zpl: string;
  /** PNG composited at the same dimensions for dev/eyeball preview. */
  previewPng: Buffer;
};

/**
 * Mode dispatch — every producer (enqueue, admin test print) calls this.
 * While the temporary 40×30mm paper is loaded (see label-mode.ts) it
 * routes to the text-only renderer; the full 50×80 photo layout below
 * stays intact for the flip back. Dynamic import keeps the two renderer
 * modules from forming a static cycle (render-text-label imports
 * formatPickupStamp / wrapModifierLine / types from this file).
 */
export async function renderCupLabel(input: CupLabelInput): Promise<CupLabelOutput> {
  const { CUP_LABEL_PAPER_MODE } = await import("./label-mode");
  if (CUP_LABEL_PAPER_MODE === "text-40x30") {
    const { renderTextCupLabel } = await import("./render-text-label");
    return renderTextCupLabel(input);
  }
  return renderPhotoCupLabel(input);
}

export async function renderPhotoCupLabel(input: CupLabelInput): Promise<CupLabelOutput> {
  // Fortune (POS / in-store) path: no doodle raster, the middle band
  // is a plain ZPL ^FB text block. Skip the entire SVG→PNG→1-bit
  // pipeline — the printer renders the glyphs natively from its stock
  // ^A0 scalable font, which is sharper and ~85KB smaller in ZPL.
  // Bottom band stack (drink / modifiers / note), shared by the ZPL and the
  // preview so both agree on fonts and positions. Keepsake copies carry none
  // of it.
  const band = input.keepsake
    ? null
    : layoutBottomBand(input.drinkName, input.modifiersText, sanitizeLabelNote(input.customerNote));

  if (input.fortuneText) {
    const logo = await getMandyLogoZpl();
    const zpl = buildZpl({
      sticker: input.stickerNumber,
      cupFrac: `${input.cupIdxOf.idx}/${input.cupIdxOf.total}`,
      drinkName: input.drinkName,
      greeting: formatGreeting(input.customerFirstName ?? null),
      band,
      pickupStamp: formatPickupStamp(input.pickupAt),
      fortuneText: input.fortuneText,
      logoHex: logo.hex,
      logoTotalBytes: logo.totalBytes,
      logoWidthBytes: logo.widthBytes,
    });
    const previewPng = await renderPreviewPng(input, null, band);
    return { zpl, previewPng };
  }

  // Doodle path: (SVG → resvg PNG) OR (caller-supplied PNG) → grayscale
  //   → threshold → 1-bit packed.
  // We need both a 1-bit packed buffer (for ZPL ^GFA hex embed) and the
  // grayscale PNG (for the dev preview composite). Render the PNG once
  // and reuse it via sharp's clone() for both branches.
  const doodlePngBuffer = input.doodlePngBuffer
    ? await sharp(input.doodlePngBuffer)
        .resize(DOODLE_SIZE, DOODLE_SIZE, { fit: "cover" })
        .png()
        .toBuffer()
    : await renderSvgToPng(input.doodleSvg, {
        widthPx: DOODLE_SIZE,
        heightPx: DOODLE_SIZE,
      });
  const doodleGray = await sharp(doodlePngBuffer)
    .grayscale()
    .threshold(128)
    .raw()
    .toBuffer();
  const doodleBytes = packTo1Bit(doodleGray, DOODLE_SIZE, DOODLE_SIZE);
  const doodleWidthBytes = DOODLE_SIZE / 8;
  const doodleTotalBytes = doodleBytes.length;
  const doodleHex = doodleBytes.toString("hex").toUpperCase();

  const logo = await getMandyLogoZpl();
  const zpl = buildZpl({
    sticker: input.stickerNumber,
    cupFrac: `${input.cupIdxOf.idx}/${input.cupIdxOf.total}`,
    drinkName: input.drinkName,
    greeting: formatGreeting(input.customerFirstName ?? null),
    band,
    pickupStamp: formatPickupStamp(input.pickupAt),
    doodleHex,
    doodleTotalBytes,
    doodleWidthBytes,
    logoHex: logo.hex,
    logoTotalBytes: logo.totalBytes,
    logoWidthBytes: logo.widthBytes,
  });

  const previewPng = await renderPreviewPng(input, doodlePngBuffer, band);

  return { zpl, previewPng };
}

function buildZpl(args: {
  sticker: string;
  cupFrac: string;
  drinkName: string;
  greeting: string;
  /**
   * The laid-out bottom band (drink / modifiers / note) — see
   * layoutBottomBand. Null on keepsake copies, which omit all three.
   */
  band: BottomBandLayout | null;
  /** "PU 5:45pm", or "" for an ASAP order. */
  pickupStamp: string;
  doodleHex?: string;
  doodleTotalBytes?: number;
  doodleWidthBytes?: number;
  fortuneText?: string;
  logoHex: string;
  logoTotalBytes: number;
  logoWidthBytes: number;
}): string {
  const parts: string[] = [];
  parts.push("^XA");
  parts.push(`^PW${LABEL_WIDTH_DOTS}`);
  parts.push(`^LL${LABEL_HEIGHT_DOTS}`);
  parts.push("^CI28");           // UTF-8
  parts.push("^PR4");            // 4 ips — slower but cleaner for dense graphic
  parts.push("^LH0,0");

  // Top band: black bar with white text. ^GB draws a filled rect using
  // the third arg as line thickness (set = height = solid fill).
  parts.push(`^FO0,0^GB${LABEL_WIDTH_DOTS},${TOP_BAND_HEIGHT},${TOP_BAND_HEIGHT}^FS`);
  // Greeting (vertically centered) at the standard left padding, e.g.
  // "Hi, Stan". Font scales down for longer names so the field block
  // always fits TOP_GREETING_WIDTH on a single line.
  const greetingFont = greetingFontSizeFor(args.greeting);
  parts.push(
    `^FO${TOP_GREETING_X},${TOP_GREETING_Y}^A0N,${greetingFont},${greetingFont}^FR^FB${TOP_GREETING_WIDTH},1,0,L,0^FD${escapeZpl(args.greeting)}^FS`,
  );
  // Right column: sticker number + cup fraction (large, right-aligned). A
  // scheduled order stacks its pickup time underneath, both a size down.
  if (args.pickupStamp) {
    const fs = TOP_RIGHT_TWO_LINE_FONT;
    parts.push(
      `^FO${TOP_RIGHT_X},${TOP_STICKER_TWO_LINE_Y}^A0N,${fs},${fs}^FR^FB${TOP_RIGHT_WIDTH},1,0,R,0^FD${escapeZpl(args.sticker)} · ${escapeZpl(args.cupFrac)}^FS`,
    );
    parts.push(
      `^FO${TOP_RIGHT_X},${TOP_PICKUP_Y}^A0N,${fs},${fs}^FR^FB${TOP_RIGHT_WIDTH},1,0,R,0^FD${escapeZpl(args.pickupStamp)}^FS`,
    );
  } else {
    parts.push(
      `^FO${TOP_RIGHT_X},${TOP_STICKER_Y}^A0N,46,46^FR^FB${TOP_RIGHT_WIDTH},1,0,R,0^FD${escapeZpl(args.sticker)} · ${escapeZpl(args.cupFrac)}^FS`,
    );
  }

  // Middle band: either a fortune-cookie sentence (POS / in-store path)
  // or the doodle raster (web/app path). Mutually exclusive — the
  // renderCupLabel branch above guarantees exactly one is populated.
  if (args.fortuneText !== undefined) {
    // Center the fortune across the middle band. ^FB params:
    //   width, max-lines, line-spacing, alignment, hanging-indent.
    // 5-12 word sentences typically wrap to 1–3 lines at this font
    // size; the 5-line cap stays for safety. Vertical offset puts the
    // bottom of a single line near the band's vertical middle.
    const fontSize = FORTUNE_FONT_SIZE;
    const innerW = LABEL_WIDTH_DOTS - FORTUNE_PADDING_X * 2;
    const yMid = TOP_BAND_HEIGHT + Math.floor(MIDDLE_BAND_HEIGHT / 2) - fontSize;
    parts.push(
      `^FO${FORTUNE_PADDING_X},${yMid}^A0N,${fontSize},${fontSize}^FB${innerW},5,${FORTUNE_LINE_SPACING},C,0^FD${escapeZpl(args.fortuneText)}^FS`,
    );
  } else {
    // ^GFA (ASCII hex graphic field): a=A ascii, b/c=total bytes,
    // d=bytes per row.
    parts.push(
      `^FO${DOODLE_LEFT},${TOP_BAND_HEIGHT}^GFA,${args.doodleTotalBytes},${args.doodleTotalBytes},${args.doodleWidthBytes},${args.doodleHex}^FS`,
    );
  }

  // Bottom band: a stack of drink name, modifier list and customer note in
  // the column left of the Mandy logo (bottom-right corner). Positions and
  // fonts come from layoutBottomBand — see "Bottom band layout" below.
  //   y_rel=0    2-dot horizontal divider across full label width
  //   y_rel=12+  drink (^FB, printer wraps to ≤2 lines)
  //              modifier list, pre-wrapped, one `\&` line per group/row
  //              "Note: …", pre-wrapped
  //   y_rel=147  logo footprint
  // ^GB draws a filled rect (last arg = stroke thickness, set = height
  // when ≤ height → solid bar).
  parts.push(`^FO0,${BOTTOM_BAND_Y}^GB${LABEL_WIDTH_DOTS},2,2^FS`);

  // Keepsake copies print everything except the drink name, modifier list
  // and note — the divider and logo below stay so the band still frames.
  if (args.band) {
    const { drink, mods, note } = args.band;
    parts.push(
      `^FO20,${BOTTOM_BAND_Y + drink.y}^A0N,${drink.font},${drink.font}^FB${BAND_TEXT_WIDTH},2,${drink.gap},L,0^FD${escapeZpl(args.drinkName)}^FS`,
    );
    // Pre-wrapped rows joined with `\&` (ZPL line-break inside ^FD): our
    // zebra-format modifiers break on `+` / ` -> `, which ^FB's own
    // space-wrapping would not honour.
    for (const block of [mods, note]) {
      if (!block) continue;
      parts.push(
        `^FO20,${BOTTOM_BAND_Y + block.y}^A0N,${block.font},${block.font}^FB${BAND_TEXT_WIDTH},${block.lines.length},${block.gap},L,0^FD${block.lines.map(escapeZpl).join("\\&")}^FS`,
      );
    }
  }

  // Mandy logo at the bottom-right of the white bottom band. No ^FR
  // here — the band is white so the logo's pre-binarised print-bits
  // paint as black ink directly.
  parts.push(
    `^FO${LOGO_X},${LOGO_Y}^GFA,${args.logoTotalBytes},${args.logoTotalBytes},${args.logoWidthBytes},${args.logoHex}^FS`,
  );

  parts.push("^XZ");
  return parts.join("\n");
}

// ---- Preview PNG (dev only) ----

async function renderPreviewPng(
  input: CupLabelInput,
  doodlePngBuffer: Buffer | null,
  band: BottomBandLayout | null,
): Promise<Buffer> {
  const top = await renderTopBandPng(input);
  const middle = input.fortuneText
    ? await renderFortuneBandPng(input.fortuneText)
    : await renderMiddleBandPng(doodlePngBuffer!);
  const bottom = await renderBottomBandPng(band);
  return sharp({
    create: {
      width: LABEL_WIDTH_DOTS,
      height: LABEL_HEIGHT_DOTS,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite([
      { input: top, top: 0, left: 0 },
      { input: middle, top: TOP_BAND_HEIGHT, left: 0 },
      { input: bottom, top: BOTTOM_BAND_Y, left: 0 },
    ])
    .png()
    .toBuffer();
}

async function renderTopBandPng(input: CupLabelInput): Promise<Buffer> {
  // Slim top band (90 dots): just greeting + sticker fraction.
  // Drink name + modifier moved to bottom band 2026-05-22.
  const { stickerNumber, cupIdxOf, customerFirstName } = input;
  const total = Math.max(1, cupIdxOf.total);
  const idx = Math.min(Math.max(1, cupIdxOf.idx), total);
  const greeting = formatGreeting(customerFirstName ?? null);
  const rightEdge = LABEL_WIDTH_DOTS - 20;
  const greetingFs = greetingFontSizeFor(greeting);
  const pickupStamp = formatPickupStamp(input.pickupAt);

  // Mirrors the ZPL branch above: scheduled orders stack sticker + pickup
  // time in the right column at a smaller size, ASAP orders keep one line.
  const rightColumn = pickupStamp
    ? `<text x="${rightEdge}" y="40" text-anchor="end" font-family="sans-serif" font-size="${TOP_RIGHT_TWO_LINE_FONT}" font-weight="700" fill="white">
      ${escapeXml(stickerNumber)} · ${idx}/${total}
    </text>
    <text x="${rightEdge}" y="82" text-anchor="end" font-family="sans-serif" font-size="${TOP_RIGHT_TWO_LINE_FONT}" font-weight="700" fill="white">
      ${escapeXml(pickupStamp)}
    </text>`
    : `<text x="${rightEdge}" y="55" text-anchor="end" font-family="sans-serif" font-size="40" font-weight="700" fill="white">
      ${escapeXml(stickerNumber)} · ${idx}/${total}
    </text>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${LABEL_WIDTH_DOTS}" height="${TOP_BAND_HEIGHT}">
    <rect width="100%" height="100%" fill="black"/>
    <text x="${TOP_GREETING_X}" y="60" font-family="sans-serif" font-size="${greetingFs}" font-weight="700" fill="white">
      ${escapeXml(greeting)}
    </text>
    ${rightColumn}
  </svg>`;
  return renderSvgToPng(svg, { widthPx: LABEL_WIDTH_DOTS, heightPx: TOP_BAND_HEIGHT });
}

// Dev preview of the fortune (POS) middle band. Mirrors the ZPL ^FB
// layout — same font size, padding, center alignment — so an admin
// looking at the eyeball preview sees roughly what the printer emits.
// Naive word-wrap by greedy-fill of the inner width; the dev preview
// doesn't have access to the printer's real glyph metrics so this
// approximates with a 28-char-per-line budget at 55-dot font.
async function renderFortuneBandPng(fortune: string): Promise<Buffer> {
  const lines = wrapFortunePreview(fortune, FORTUNE_PREVIEW_CHARS_PER_LINE);
  const lineHeight = FORTUNE_FONT_SIZE + FORTUNE_LINE_SPACING;
  const blockHeight = lines.length * lineHeight;
  const yStart = Math.floor((MIDDLE_BAND_HEIGHT - blockHeight) / 2) + FORTUNE_FONT_SIZE;
  const textElems = lines
    .map(
      (line, i) =>
        `<text x="${LABEL_WIDTH_DOTS / 2}" y="${yStart + i * lineHeight}" text-anchor="middle" font-family="sans-serif" font-size="${FORTUNE_FONT_SIZE}" font-weight="600" fill="black">${escapeXml(line)}</text>`,
    )
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${LABEL_WIDTH_DOTS}" height="${MIDDLE_BAND_HEIGHT}">
    <rect width="100%" height="100%" fill="white"/>
    ${textElems}
  </svg>`;
  return renderSvgToPng(svg, { widthPx: LABEL_WIDTH_DOTS, heightPx: MIDDLE_BAND_HEIGHT });
}

const FORTUNE_PREVIEW_CHARS_PER_LINE = 20;

function wrapFortunePreview(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur.length === 0) cur = w;
    else if (cur.length + 1 + w.length <= maxChars) cur = `${cur} ${w}`;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

async function renderMiddleBandPng(doodlePng: Buffer): Promise<Buffer> {
  // When DOODLE_SIZE overflows LABEL_WIDTH_DOTS (the edge-to-edge layout),
  // sharp's composite rejects a wider-than-canvas input. Crop the doodle
  // to label width first — this mirrors the silent clip the ZD410 print
  // head applies to the rightmost overflow bits.
  const inputForComposite =
    DOODLE_SIZE > LABEL_WIDTH_DOTS
      ? await sharp(doodlePng)
          .extract({ left: 0, top: 0, width: LABEL_WIDTH_DOTS, height: DOODLE_SIZE })
          .toBuffer()
      : doodlePng;
  return sharp({
    create: {
      width: LABEL_WIDTH_DOTS,
      height: MIDDLE_BAND_HEIGHT,
      channels: 3,
      background: "white",
    },
  })
    .composite([{ input: inputForComposite, top: 0, left: DOODLE_LEFT }])
    .png()
    .toBuffer();
}

async function renderBottomBandPng(band: BottomBandLayout | null): Promise<Buffer> {
  // Mirrors the ZPL stack: same fonts and y offsets as layoutBottomBand
  // handed to buildZpl, drink lines estimated with the same char-width
  // heuristic. Keepsake copies (band = null) show just the divider + logo.
  const textElem = (block: BandTextBlock, weight: string, style: string) =>
    block.lines
      .map(
        (line, i) =>
          `<text x="20" y="${block.y + block.font + i * (block.font + block.gap)}" font-family="sans-serif" font-size="${block.font}" font-weight="${weight}" font-style="${style}" fill="black">${escapeXml(line)}</text>`,
      )
      .join("");
  let bodyText = "";
  if (band) {
    bodyText += textElem(band.drink, "700", "normal");
    if (band.mods) bodyText += textElem(band.mods, "400", "normal");
    if (band.note) bodyText += textElem(band.note, "400", "italic");
  }

  const lx = LABEL_WIDTH_DOTS - MANDY_LOGO_WIDTH - LOGO_MARGIN;
  const ly = BOTTOM_BAND_HEIGHT - MANDY_LOGO_HEIGHT - LOGO_MARGIN;
  const logoElem = `<rect x="${lx}" y="${ly}" width="${MANDY_LOGO_WIDTH}" height="${MANDY_LOGO_HEIGHT}" rx="8" fill="black"/>
      <text x="${lx + MANDY_LOGO_WIDTH / 2}" y="${ly + MANDY_LOGO_HEIGHT / 2 + 5}" text-anchor="middle" font-family="serif" font-size="20" fill="white" font-style="italic">Mandy</text>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${LABEL_WIDTH_DOTS}" height="${BOTTOM_BAND_HEIGHT}">
    <rect width="100%" height="100%" fill="white"/>
    <rect x="0" y="0" width="${LABEL_WIDTH_DOTS}" height="2" fill="black"/>
    ${bodyText}
    ${logoElem}
  </svg>`;
  return renderSvgToPng(svg, { widthPx: LABEL_WIDTH_DOTS, heightPx: BOTTOM_BAND_HEIGHT });
}

// ---- Modifier wrapping ----

// Pre-wrap for the ZPL ^FB blocks. The chars-per-line budget comes from the
// caller (bandCharsPerLine for the photo layout, its own tiers for the 40×30
// text layout — both use the 0.55 char-width heuristic calibrated on real
// ZD410 prints: 26 chars at 32 dots across the 456-dot column). The 5-line
// default cap is only the fallback for direct callers; the layouts pass
// their own budget and only ellipsize as a last resort.
const MOD_MAX_LINES = 5;

// Tokenizes the modifier line on both ` -> ` (section sep) and `+`
// (topping sep) so a long toppings run wraps to additional rows. Sep
// glyph stays attached to the preceding token.
function tokenizeModLine(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    if (text.slice(i, i + 4) === " -> ") {
      out.push(cur + " -> ");
      cur = "";
      i += 3;
    } else if (text[i] === "+") {
      out.push(cur + "+");
      cur = "";
    } else {
      cur += text[i];
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function wrapModifierLine(
  text: string,
  maxChars: number,
  maxLines: number = MOD_MAX_LINES,
): string[] {
  if (!text) return [];
  // format-modifiers emits one group per line, separated by `\n`. Honor
  // those explicit breaks first so each attribute (milk / toppings /
  // ice / sugar) keeps its own row. Long toppings lines that exceed
  // `maxChars` get further word-wrapped via the existing `+` / ` -> `
  // tokenization so they still fit within the band width.
  //
  // `maxLines` defaults to this photo layout's cap; the 40x30 text
  // layout passes Infinity and applies its own vertical-budget cap.
  const groups = text.split("\n");
  const lines: string[] = [];
  for (const group of groups) {
    if (group.length === 0) continue;
    if (group.length <= maxChars) {
      lines.push(group);
      continue;
    }
    const tokens = tokenizeModLine(group);
    let cur = "";
    for (const t of tokens) {
      if (t.length > maxChars) {
        // A single token wider than the line — a long topping name, or a
        // free-text note with no `+` / `->` in it. Break it at spaces so the
        // line count we report is the line count the printer draws (^FB
        // would wrap it on its own and push everything below off the band).
        if (cur) lines.push(cur);
        const chunks = wrapAtSpaces(t, maxChars);
        lines.push(...chunks.slice(0, -1));
        cur = chunks[chunks.length - 1];
        continue;
      }
      if (cur.length === 0) cur = t;
      else if (cur.length + t.length <= maxChars) cur += t;
      else { lines.push(cur); cur = t; }
    }
    if (cur) lines.push(cur);
  }
  if (lines.length <= maxLines) return lines;
  const truncated = lines.slice(0, maxLines);
  const last = truncated[maxLines - 1];
  truncated[maxLines - 1] = last.length > maxChars - 1
    ? last.slice(0, maxChars - 1) + "…"
    : last + " …";
  return truncated;
}

// Greedy word-wrap of one over-long token; a single word wider than the
// line is hard-cut so nothing can ever exceed `maxChars`.
function wrapAtSpaces(text: string, maxChars: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const word of text.split(" ").filter((w) => w.length > 0)) {
    const pieces: string[] = [];
    for (let i = 0; i < word.length; i += maxChars) pieces.push(word.slice(i, i + maxChars));
    for (const p of pieces) {
      if (cur.length === 0) cur = p;
      else if (cur.length + 1 + p.length <= maxChars) cur += ` ${p}`;
      else { out.push(cur); cur = p; }
    }
  }
  if (cur) out.push(cur);
  return out.length > 0 ? out : [""];
}

// ---- Bottom band layout: drink + modifiers + customer note ----
//
// BOTTOM_BAND_HEIGHT (253 dots) has to carry the drink name, every modifier
// group in full and — since 2026-09-06 — the customer's note for the
// barista. Fixed y positions and a 5-line modifier cap used to do this job;
// they ellipsized the sugar level on a milk + 3 toppings + ice + sugar order
// and had no room for a note at all. The band is now laid out as a stack —
// drink, modifiers directly underneath, then the note — and the fonts step
// down through BAND_TIERS until the stack fits. When even the smallest tier
// overflows, the note gives up lines first (3 → 1, then vanishes — it is
// still on the Square ticket), and only after that does the modifier list
// ellipsize, exactly as it did before.
const BAND_TOP_PAD = 12; // below the 2-dot divider
const BAND_BOTTOM_PAD = 6;
// Text stays in the column left of the logo; the logo is bottom-right.
export const BAND_TEXT_WIDTH = LABEL_WIDTH_DOTS - 40 - (MANDY_LOGO_WIDTH + LOGO_MARGIN);
// Char-width heuristic calibrated on real ZD410 prints (26 chars at 32 dots
// across the 456-dot column).
const CHAR_WIDTH_RATIO = 0.55;
const DRINK_LINE_SPACING = 4;
const DRINK_MODS_GAP = 8;
const MODS_NOTE_GAP = 6;
export const NOTE_MAX_LINES = 3;

type BandTier = { drinkMax: number; modFont: number; modGap: number; noteFont: number; noteGap: number };
// Tier 0 is the 2026-05-22 look (drink up to 60, modifiers 32/4) — a simple
// order without a note prints exactly the sizes it did before.
export const BAND_TIERS: readonly BandTier[] = [
  { drinkMax: 60, modFont: 32, modGap: 4, noteFont: 28, noteGap: 3 },
  { drinkMax: 42, modFont: 30, modGap: 3, noteFont: 26, noteGap: 2 },
  { drinkMax: 36, modFont: 28, modGap: 2, noteFont: 24, noteGap: 2 },
  { drinkMax: 32, modFont: 26, modGap: 2, noteFont: 22, noteGap: 1 },
  { drinkMax: 28, modFont: 24, modGap: 1, noteFont: 20, noteGap: 1 },
];

export type BandTextBlock = {
  /** y offset from the top of the bottom band (add BOTTOM_BAND_Y for ^FO). */
  y: number;
  font: number;
  /** ZPL ^FB inter-line spacing; the line pitch is font + gap. */
  gap: number;
  lines: string[];
};

export type BottomBandLayout = {
  /** `lines` here is an estimate — the printer wraps the name itself (^FB, ≤2 lines). */
  drink: BandTextBlock;
  mods: BandTextBlock | null;
  note: BandTextBlock | null;
  /** Index into BAND_TIERS that was used. */
  tier: number;
  /** Stacked height including padding; ≤ BOTTOM_BAND_HEIGHT unless nothing could fit. */
  height: number;
};

export function bandCharsPerLine(font: number): number {
  return Math.max(1, Math.floor(BAND_TEXT_WIDTH / (CHAR_WIDTH_RATIO * font)));
}

// Chars per line for the drink name at a given font. drinkFontSizeFor's
// thresholds encode what a real ZD410 fits on one line of CG Triumvirate
// Bold Condensed (14 chars at 60, …) — a little more than the 0.55 ratio
// predicts — so a name the tier was chosen for is never budgeted as two
// lines. The printer still wraps for real (^FB, 2 lines) if it has to.
const DRINK_ONE_LINE_CHARS: Record<number, number> = { 60: 14, 50: 18, 42: 22, 34: 27 };
function drinkCharsPerLine(font: number): number {
  return Math.max(DRINK_ONE_LINE_CHARS[font] ?? 0, bandCharsPerLine(font));
}

function blockHeight(block: BandTextBlock): number {
  return block.lines.length * (block.font + block.gap);
}

/**
 * Lay the bottom band out for this cup. `note` is the already-sanitised
 * customer note ("" for none); the "Note: " prefix is added here.
 */
export function layoutBottomBand(
  drinkName: string,
  modifiersText: string,
  note: string,
): BottomBandLayout {
  const naturalDrinkFont = drinkFontSizeFor(drinkName);
  const noteText = note ? `${NOTE_PREFIX}${note}` : "";

  const stack = (tierIdx: number, noteMaxLines: number, modMaxLines: number): BottomBandLayout => {
    const tier = BAND_TIERS[tierIdx];
    const drinkFont = Math.min(naturalDrinkFont, tier.drinkMax);
    let y = BAND_TOP_PAD;
    const drink: BandTextBlock = {
      y,
      font: drinkFont,
      gap: DRINK_LINE_SPACING,
      lines: wrapModifierLine(drinkName, drinkCharsPerLine(drinkFont), 2),
    };
    y += blockHeight(drink);
    let mods: BandTextBlock | null = null;
    if (modifiersText.length > 0) {
      y += DRINK_MODS_GAP;
      mods = {
        y,
        font: tier.modFont,
        gap: tier.modGap,
        lines: wrapModifierLine(modifiersText, bandCharsPerLine(tier.modFont), modMaxLines),
      };
      y += blockHeight(mods);
    }
    let noteBlock: BandTextBlock | null = null;
    if (noteText && noteMaxLines > 0) {
      y += mods ? MODS_NOTE_GAP : DRINK_MODS_GAP;
      noteBlock = {
        y,
        font: tier.noteFont,
        gap: tier.noteGap,
        lines: wrapModifierLine(noteText, bandCharsPerLine(tier.noteFont), noteMaxLines),
      };
      y += blockHeight(noteBlock);
    }
    return { drink, mods, note: noteBlock, tier: tierIdx, height: y + BAND_BOTTOM_PAD };
  };
  const fits = (l: BottomBandLayout) => l.height <= BOTTOM_BAND_HEIGHT;

  // 1. The largest tier that carries everything in full.
  for (let i = 0; i < BAND_TIERS.length; i++) {
    const l = stack(i, NOTE_MAX_LINES, Number.POSITIVE_INFINITY);
    if (fits(l)) return l;
  }
  const last = BAND_TIERS.length - 1;
  // 2. Smallest tier, note shortened a line at a time; modifiers still whole.
  for (let n = NOTE_MAX_LINES - 1; n >= 0; n--) {
    const l = stack(last, n, Number.POSITIVE_INFINITY);
    if (fits(l)) return l;
  }
  // 3. Even without a note the modifiers overflow: ellipsize them to the
  //    rows that fit (the pre-2026-09 behaviour), never fewer than one.
  const probe = stack(last, 0, 1);
  const tier = BAND_TIERS[last];
  const modsTop = probe.mods ? probe.mods.y : probe.height;
  const room = BOTTOM_BAND_HEIGHT - BAND_BOTTOM_PAD - modsTop;
  const maxModLines = Math.max(1, Math.floor(room / (tier.modFont + tier.modGap)));
  return stack(last, 0, maxModLines);
}

// ---- Helpers ----

function escapeZpl(s: string): string {
  // ZPL has 3 control chars: ^ (format prefix), ~ (control prefix), \
  // (escape). Replace with safe substitutes so user content can't break
  // parsing on the printer firmware.
  return s.replace(/\\/g, "/").replace(/\^/g, "-").replace(/~/g, "-");
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
}

function packTo1Bit(grayscale: Buffer, w: number, h: number): Buffer {
  const widthBytes = w / 8;
  if (!Number.isInteger(widthBytes)) {
    throw new Error(`width ${w} must be a multiple of 8 for 1-bit packing`);
  }
  const out = Buffer.alloc(widthBytes * h, 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = grayscale[y * w + x];
      // After threshold(): 0 = black, 255 = white. ZPL ^GFA bit 1 = print
      // (black dot). So black pixels (< 128) set the bit.
      if (px < 128) {
        const byte = y * widthBytes + (x >>> 3);
        out[byte] |= 0x80 >>> (x & 7);
      }
    }
  }
  return out;
}
