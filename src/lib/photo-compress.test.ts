import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { compressForEmail } from "./photo-compress";

const FIXTURE = path.resolve(
  __dirname,
  "__fixtures__/sample-photo.jpg",
);

describe("compressForEmail", () => {
  it("compresses a real photo to a smaller jpeg buffer", async () => {
    const input = await readFile(FIXTURE);
    const result = await compressForEmail(input, "image/jpeg", 0);
    expect(result.filename).toBe("photo-1.jpg");
    expect(result.buffer.length).toBeLessThan(input.length);
    // Quality 80 + 1920px max should keep result well under 1 MB for typical input
    expect(result.buffer.length).toBeLessThan(1_000_000);
  });

  it("outputs jpeg even for png input", async () => {
    // A tiny 1x1 png
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      "base64",
    );
    const result = await compressForEmail(png, "image/png", 1);
    expect(result.filename).toBe("photo-2.jpg");
    // jpeg magic number FF D8 FF
    expect(result.buffer.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });

  it("rejects non-image mime", async () => {
    const buf = Buffer.from("not an image");
    await expect(compressForEmail(buf, "application/pdf", 0)).rejects.toThrow(
      /unsupported mime/i,
    );
  });
});
