// Star Micronics ESC/GS raster command builder for TSP100IV SK in CloudPRNT mode.
// Reference: Star Programming Manual, "Set Bit Image (raster format)" + "Form feed to next die-cut gap".

const ESC = 0x1b;
const GS = 0x1d;

export function encodeWidthBytes(widthBytes: number): Buffer {
  if (widthBytes < 0 || widthBytes > 0xffff) throw new Error("widthBytes out of range");
  const b = Buffer.alloc(2);
  b[0] = widthBytes & 0xff;
  b[1] = (widthBytes >>> 8) & 0xff;
  return b;
}

export function buildLabelJob(bitmap: Buffer, widthBytes: number, heightDots: number): Buffer {
  if (!Number.isInteger(widthBytes) || widthBytes < 1 || widthBytes > 0xffff) {
    throw new Error(`widthBytes must be integer in [1, 65535], got ${widthBytes}`);
  }
  if (!Number.isInteger(heightDots) || heightDots < 1) {
    throw new Error(`heightDots must be positive integer, got ${heightDots}`);
  }
  if (bitmap.length !== widthBytes * heightDots) {
    throw new Error(`bitmap size ${bitmap.length} != widthBytes(${widthBytes}) * heightDots(${heightDots})`);
  }

  const init           = Buffer.from([ESC, 0x40]);                  // initialize
  const enableGap      = Buffer.from([ESC, GS, 0x61, 0x01]);        // die-cut gap sensor on
  const enterRaster    = Buffer.from([ESC, 0x2a, 0x72, 0x41]);      // raster mode begin
  const setWidthCmd    = Buffer.concat([Buffer.from([ESC, 0x2a, 0x72, 0x52]), encodeWidthBytes(widthBytes)]);
  const exitRaster     = Buffer.from([ESC, 0x2a, 0x72, 0x42]);      // raster mode end
  const formFeedToGap  = Buffer.from([ESC, 0x64, 0x02]);            // feed to next die-cut gap

  return Buffer.concat([
    init,
    enableGap,
    enterRaster,
    setWidthCmd,
    bitmap,
    exitRaster,
    formFeedToGap,
  ]);
}
