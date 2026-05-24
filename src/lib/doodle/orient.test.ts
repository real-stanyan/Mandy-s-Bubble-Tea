import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { autoOrientImage } from "./orient";

// Regression guard for the 2026-05-24 OL848 bug: customer camera selfies
// carry an EXIF Orientation tag (portrait phone shots are usually stored
// landscape + Orientation=6/8). sharp does NOT honour that tag unless you
// call .rotate() with no args before other ops, so the cup-label pipeline
// printed the photo rotated 90°. autoOrientImage bakes the EXIF rotation
// into the pixels and strips the tag, up front, for every downstream
// consumer (binarize + the admin gallery color original).

async function landscapeWithOrientation(orientation: number): Promise<Buffer> {
  // 40 wide × 20 tall (landscape) raw pixels, tagged so a viewer should
  // rotate it to 20×40 (portrait) on display.
  return sharp({
    create: {
      width: 40,
      height: 20,
      channels: 3,
      background: { r: 200, g: 50, b: 50 },
    },
  })
    .withMetadata({ orientation })
    .jpeg()
    .toBuffer();
}

describe("autoOrientImage", () => {
  it("bakes EXIF orientation=6 into pixels (landscape → portrait) and strips the tag", async () => {
    const input = await landscapeWithOrientation(6);
    // Sanity: input metadata still says 40×20 with orientation 6.
    const inMeta = await sharp(input).metadata();
    expect(inMeta.width).toBe(40);
    expect(inMeta.height).toBe(20);
    expect(inMeta.orientation).toBe(6);

    const out = await autoOrientImage(input);
    const outMeta = await sharp(out).metadata();
    // Pixels are now actually rotated to portrait, no orientation tag left.
    expect(outMeta.width).toBe(20);
    expect(outMeta.height).toBe(40);
    expect(outMeta.orientation ?? 1).toBe(1);
  });

  it("leaves an already-upright image (orientation=1) unrotated", async () => {
    const input = await landscapeWithOrientation(1);
    const out = await autoOrientImage(input);
    const outMeta = await sharp(out).metadata();
    expect(outMeta.width).toBe(40);
    expect(outMeta.height).toBe(20);
  });
});
