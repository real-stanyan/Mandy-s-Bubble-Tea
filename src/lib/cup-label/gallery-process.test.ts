import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { processGalleryImage, md5Hex } from "./gallery-process";

async function redSquare(): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 220, g: 30, b: 30 } } })
    .png().toBuffer();
}

describe("gallery-process", () => {
  it("md5Hex is 32 lowercase hex chars", () => {
    expect(md5Hex(Buffer.from("x"))).toMatch(/^[a-f0-9]{32}$/);
  });

  it("processGalleryImage yields hash + 592x592 1-bit binarized + color png", async () => {
    const raw = await redSquare();
    const out = await processGalleryImage(raw);
    expect(out.hash).toBe(md5Hex(raw));
    const binMeta = await sharp(out.binarizedPng).metadata();
    expect(binMeta.width).toBe(592);
    expect(binMeta.height).toBe(592);
    const colorMeta = await sharp(out.colorPng).metadata();
    expect(colorMeta.format).toBe("png");
    expect(colorMeta.width).toBeLessThanOrEqual(480);
  });
});
