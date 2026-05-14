import "server-only";
import sharp from "sharp";
import { renderSvgToPng } from "../doodle/render-svg";

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
//   • Middle (40mm = 472 dots): user/preset doodle, square, centered.
//   • Bottom (~20mm = remainder): modifier text in zebra format
//                                 (Pearls(2)+Pudding -> L.Ice -> 50%S).
const TOP_BAND_HEIGHT = 120;
const MIDDLE_BAND_HEIGHT = 472;
const BAND_GAP = 10; // dot row gap between middle and bottom
const BOTTOM_BAND_Y = TOP_BAND_HEIGHT + MIDDLE_BAND_HEIGHT + BAND_GAP;
const BOTTOM_BAND_HEIGHT = LABEL_HEIGHT_DOTS - BOTTOM_BAND_Y;

// Doodle is rendered as a square that fills the middle band height,
// centered horizontally inside the 590-dot width. 472/8 = 59 bytes/row
// (exact, no padding needed for ^GFA).
const DOODLE_SIZE = MIDDLE_BAND_HEIGHT;
const DOODLE_LEFT = Math.floor((LABEL_WIDTH_DOTS - DOODLE_SIZE) / 2);

export type CupLabelInput = {
  stickerNumber: string;
  cupIdxOf: { idx: number; total: number };
  drinkName: string;
  modifiersText: string;
  doodleSvg: string;
};

export type CupLabelOutput = {
  /** ZPL II string ready to send to a 300 DPI Zebra. */
  zpl: string;
  /** PNG composited at the same dimensions for dev/eyeball preview. */
  previewPng: Buffer;
};

export async function renderCupLabel(input: CupLabelInput): Promise<CupLabelOutput> {
  // Doodle path: SVG → resvg PNG → grayscale → threshold → 1-bit packed.
  // We need both a 1-bit packed buffer (for ZPL ^GFA hex embed) and the
  // grayscale PNG (for the dev preview composite). Render the PNG once
  // and reuse it via sharp's clone() for both branches.
  const doodlePngBuffer = await renderSvgToPng(input.doodleSvg, {
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

  const zpl = buildZpl({
    sticker: input.stickerNumber,
    cupFrac: `${input.cupIdxOf.idx}/${input.cupIdxOf.total}`,
    drinkName: input.drinkName,
    modifiers: input.modifiersText,
    doodleHex,
    doodleTotalBytes,
    doodleWidthBytes,
  });

  const previewPng = await renderPreviewPng(input, doodlePngBuffer);

  return { zpl, previewPng };
}

function buildZpl(args: {
  sticker: string;
  cupFrac: string;
  drinkName: string;
  modifiers: string;
  doodleHex: string;
  doodleTotalBytes: number;
  doodleWidthBytes: number;
}): string {
  const innerWidth = LABEL_WIDTH_DOTS - 40; // 20px padding each side

  // Modifier wrap. ZPL ^FB auto-wraps on space, but our zebra-format
  // modifiers (e.g. "Lychee Jelly(2)+Grape Jelly+Lychee Jelly -> 50%S")
  // contain `+` / ` -> ` boundaries that need explicit breaks. Pre-wrap
  // here and join with `\&` (ZPL line-break inside ^FD).
  const modLines = args.modifiers.length > 0
    ? wrapModifierLine(args.modifiers, MOD_MAX_CHARS_PER_LINE)
    : [];
  const modField = modLines.map(escapeZpl).join("\\&");

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
  // Sticker number + cup fraction (line 1, large)
  parts.push(
    `^FO20,15^A0N,46,46^FR^FD${escapeZpl(args.sticker)} · ${escapeZpl(args.cupFrac)}^FS`,
  );
  // Drink name (line 2, smaller, single-line truncated by ^FB width)
  parts.push(
    `^FO20,72^A0N,32,32^FR^FB${innerWidth},1,0,L,0^FD${escapeZpl(args.drinkName)}^FS`,
  );

  // Middle band: doodle as ^GFA (ASCII hex graphic field).
  // Format: ^GFa,b,c,d,data
  //   a = A (ASCII hex)
  //   b = total binary byte count
  //   c = total binary byte count (same — uncompressed)
  //   d = bytes per row
  parts.push(
    `^FO${DOODLE_LEFT},${TOP_BAND_HEIGHT}^GFA,${args.doodleTotalBytes},${args.doodleTotalBytes},${args.doodleWidthBytes},${args.doodleHex}^FS`,
  );

  // Bottom band: modifier text. ^FB params: width, max-lines, line-spacing,
  // alignment, hanging-indent.
  if (modLines.length > 0) {
    const lineCount = Math.min(modLines.length, MOD_MAX_LINES);
    parts.push(
      `^FO20,${BOTTOM_BAND_Y}^A0N,30,30^FB${innerWidth},${lineCount},6,L,0^FD${modField}^FS`,
    );
  }

  parts.push("^XZ");
  return parts.join("\n");
}

// ---- Preview PNG (dev only) ----

async function renderPreviewPng(
  input: CupLabelInput,
  doodlePngBuffer: Buffer,
): Promise<Buffer> {
  const top = await renderTopBandPng(input);
  const middle = await renderMiddleBandPng(doodlePngBuffer);
  const bottom = await renderBottomBandPng(input);
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
  const { stickerNumber, cupIdxOf, drinkName } = input;
  const total = Math.max(1, cupIdxOf.total);
  const idx = Math.min(Math.max(1, cupIdxOf.idx), total);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${LABEL_WIDTH_DOTS}" height="${TOP_BAND_HEIGHT}">
    <rect width="100%" height="100%" fill="black"/>
    <text x="20" y="50" font-family="sans-serif" font-size="40" font-weight="700" fill="white">
      ${escapeXml(stickerNumber)} · ${idx}/${total}
    </text>
    <text x="20" y="100" font-family="sans-serif" font-size="30" font-weight="700" fill="white">
      ${escapeXml(drinkName)}
    </text>
  </svg>`;
  return renderSvgToPng(svg, { widthPx: LABEL_WIDTH_DOTS, heightPx: TOP_BAND_HEIGHT });
}

async function renderMiddleBandPng(doodlePng: Buffer): Promise<Buffer> {
  return sharp({
    create: {
      width: LABEL_WIDTH_DOTS,
      height: MIDDLE_BAND_HEIGHT,
      channels: 3,
      background: "white",
    },
  })
    .composite([{ input: doodlePng, top: 0, left: DOODLE_LEFT }])
    .png()
    .toBuffer();
}

async function renderBottomBandPng(input: CupLabelInput): Promise<Buffer> {
  const lines = input.modifiersText.length > 0
    ? wrapModifierLine(input.modifiersText, MOD_MAX_CHARS_PER_LINE)
    : [];
  const textElems = lines
    .map(
      (line, i) =>
        `<text x="20" y="${36 + i * 36}" font-family="sans-serif" font-size="28" fill="black">${escapeXml(line)}</text>`,
    )
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${LABEL_WIDTH_DOTS}" height="${BOTTOM_BAND_HEIGHT}">
    <rect width="100%" height="100%" fill="white"/>
    ${textElems}
  </svg>`;
  return renderSvgToPng(svg, { widthPx: LABEL_WIDTH_DOTS, heightPx: BOTTOM_BAND_HEIGHT });
}

// ---- Modifier wrapping ----

// At 300 DPI with 30-dot font in a 550-dot inner band (590 - 40 padding),
// roughly 28-32 chars fit per line. Cap at 28 for safety so wide chars
// don't overflow. 4-line max keeps the bottom band readable.
const MOD_MAX_CHARS_PER_LINE = 28;
const MOD_MAX_LINES = 4;

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

export function wrapModifierLine(text: string, maxChars: number): string[] {
  if (!text) return [];
  const tokens = tokenizeModLine(text);
  const lines: string[] = [];
  let cur = "";
  for (const t of tokens) {
    if (cur.length === 0) cur = t;
    else if (cur.length + t.length <= maxChars) cur += t;
    else { lines.push(cur); cur = t; }
  }
  if (cur) lines.push(cur);
  if (lines.length <= MOD_MAX_LINES) return lines;
  const truncated = lines.slice(0, MOD_MAX_LINES);
  const last = truncated[MOD_MAX_LINES - 1];
  truncated[MOD_MAX_LINES - 1] = last.length > maxChars - 1
    ? last.slice(0, maxChars - 1) + "…"
    : last + " …";
  return truncated;
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
