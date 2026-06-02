import "server-only";
import sharp from "sharp";

/**
 * Bake a raw image's EXIF orientation into its pixels and strip the tag.
 *
 * Phone cameras store sensor pixels in a fixed orientation and record an
 * EXIF `Orientation` tag (portrait selfies are typically stored landscape
 * with Orientation=6/8). Image viewers honour that tag, but sharp ignores
 * it unless you call `.rotate()` with no arguments before any other op —
 * so the cup-label thermal pipeline (and the admin gallery color original)
 * printed customer photos rotated 90° (the OL848 bug).
 *
 * Call this once at the upload boundary, before binarize / resize, so every
 * downstream sharp consumer sees correctly-oriented pixels and no tag.
 * `.rotate()` is a no-op for already-upright images (Orientation 1/absent).
 */
export async function autoOrientImage(raw: Buffer): Promise<Buffer> {
  return sharp(raw).rotate().toBuffer();
}
