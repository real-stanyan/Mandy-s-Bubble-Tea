import "server-only";
import sharp from "sharp";
import { renderSvgToPng } from "../doodle/render-svg";

// 50 mm x 80 mm at 203 DPI -> 400 x 640 dots
export const LABEL_WIDTH_DOTS = 400;
export const LABEL_HEIGHT_DOTS = 640;

const TOP_BAND_HEIGHT = 96;    // 12 mm
const MIDDLE_HEIGHT   = 360;   // 45 mm
const BOTTOM_HEIGHT   = 184;   // 23 mm  (96 + 360 + 184 = 640)

export type CupLabelInput = {
  stickerNumber: string;
  cupIdxOf: { idx: number; total: number };
  drinkName: string;
  modifiersText: string;
  doodleSvg: string;
};

export async function renderCupLabelToBitmap(input: CupLabelInput): Promise<Buffer> {
  const top    = await renderTopBand(input);
  const middle = await renderMiddleDoodle(input.doodleSvg);
  const bottom = await renderBottomModifiers(input);

  const composite = await sharp({
    create: {
      width: LABEL_WIDTH_DOTS,
      height: LABEL_HEIGHT_DOTS,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite([
      { input: top,    top: 0,                              left: 0 },
      { input: middle, top: TOP_BAND_HEIGHT,                left: 0 },
      { input: bottom, top: TOP_BAND_HEIGHT + MIDDLE_HEIGHT, left: 0 },
    ])
    .grayscale()
    .threshold(128)
    .raw()
    .toBuffer();

  return packTo1Bit(composite, LABEL_WIDTH_DOTS, LABEL_HEIGHT_DOTS);
}

async function renderTopBand(input: CupLabelInput): Promise<Buffer> {
  const { stickerNumber, cupIdxOf, drinkName } = input;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${LABEL_WIDTH_DOTS}" height="${TOP_BAND_HEIGHT}">
    <rect width="100%" height="100%" fill="black"/>
    <text x="12" y="36" font-family="sans-serif" font-size="32" font-weight="700" fill="white">
      ${escapeXml(stickerNumber)} · ${cupIdxOf.idx}/${cupIdxOf.total}
    </text>
    <text x="12" y="76" font-family="sans-serif" font-size="28" font-weight="700" fill="white">
      ${escapeXml(drinkName)}
    </text>
  </svg>`;
  return sharp(Buffer.from(svg)).resize(LABEL_WIDTH_DOTS, TOP_BAND_HEIGHT).png().toBuffer();
}

async function renderMiddleDoodle(doodleSvg: string): Promise<Buffer> {
  const png = await renderSvgToPng(doodleSvg, { widthPx: MIDDLE_HEIGHT, heightPx: MIDDLE_HEIGHT });
  return sharp({
    create: { width: LABEL_WIDTH_DOTS, height: MIDDLE_HEIGHT, channels: 3, background: "white" },
  })
    .composite([{ input: png, top: 0, left: Math.floor((LABEL_WIDTH_DOTS - MIDDLE_HEIGHT) / 2) }])
    .png()
    .toBuffer();
}

async function renderBottomModifiers(input: CupLabelInput): Promise<Buffer> {
  const wrapped = wrapText(input.modifiersText, 26);
  const lines = wrapped.map(
    (line, i) =>
      `<text x="12" y="${28 + i * 32}" font-family="sans-serif" font-size="22" fill="black">${escapeXml(line)}</text>`,
  ).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${LABEL_WIDTH_DOTS}" height="${BOTTOM_HEIGHT}">
    <rect width="100%" height="100%" fill="white"/>
    ${lines}
  </svg>`;
  return sharp(Buffer.from(svg)).resize(LABEL_WIDTH_DOTS, BOTTOM_HEIGHT).png().toBuffer();
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(" · ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur.length === 0) cur = w;
    else if (cur.length + 3 + w.length <= maxChars) cur += " · " + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4);
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);
}

function packTo1Bit(grayscale: Buffer, w: number, h: number): Buffer {
  const widthBytes = w / 8;
  if (!Number.isInteger(widthBytes)) throw new Error("width must be multiple of 8");
  const out = Buffer.alloc(widthBytes * h, 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = grayscale[y * w + x];
      // After threshold(): 0 = black, 255 = white. Star raster: 1 = fire dot (black).
      if (px < 128) {
        const byte = y * widthBytes + (x >>> 3);
        out[byte] |= 0x80 >>> (x & 7);
      }
    }
  }
  return out;
}
