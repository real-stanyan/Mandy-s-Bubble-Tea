import "server-only";
import sharp from "sharp";
import { PHOTO_ALLOWED_MIME } from "./order-complaint";

export type CompressedPhoto = {
  buffer: Buffer;
  filename: string;
  mimeType: "image/jpeg";
};

/**
 * Recompress a customer-uploaded photo to a small jpeg suitable for email
 * attachment. Output is always jpeg regardless of input — best email-client
 * compatibility (Apple Mail, Gmail web/iOS all preview natively).
 *
 * @param input  Raw upload bytes.
 * @param mimeType Reported by the browser; checked against allow-list.
 * @param index  Zero-based slot used to name the output file (`photo-1.jpg` …).
 */
export async function compressForEmail(
  input: Buffer,
  mimeType: string,
  index: number,
): Promise<CompressedPhoto> {
  if (!PHOTO_ALLOWED_MIME.includes(mimeType as (typeof PHOTO_ALLOWED_MIME)[number])) {
    throw new Error(`unsupported mime: ${mimeType}`);
  }

  const buffer = await sharp(input)
    .rotate() // respect EXIF orientation (iPhone HEIC)
    .resize({ width: 1920, withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();

  return {
    buffer,
    filename: `photo-${index + 1}.jpg`,
    mimeType: "image/jpeg",
  };
}
