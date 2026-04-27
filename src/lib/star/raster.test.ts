import { describe, it, expect } from "vitest";
import { buildLabelJob, encodeWidthBytes } from "./raster";

describe("Star raster command builder", () => {
  it("encodes width as little-endian 2-byte int", () => {
    expect([...encodeWidthBytes(50)]).toEqual([0x32, 0x00]);
    expect([...encodeWidthBytes(400)]).toEqual([0x90, 0x01]);
  });

  it("wraps raster in correct ESC/GS envelope", () => {
    const widthBytes = 50;       // 400 dots / 8
    const heightDots = 640;
    const bitmap = Buffer.alloc(widthBytes * heightDots, 0); // all zeros
    const job = buildLabelJob(bitmap, widthBytes, heightDots);

    // First 2 bytes: ESC @ initialize
    expect([job[0], job[1]]).toEqual([0x1b, 0x40]);
    // Followed by gap-sensor enable
    expect([job[2], job[3], job[4], job[5]]).toEqual([0x1b, 0x1d, 0x61, 0x01]);
    // Should end with form feed to next gap
    const tail = job.slice(-3);
    expect([...tail]).toEqual([0x1b, 0x64, 0x02]);
    // Bitmap bytes should appear unchanged inside the buffer
    expect(job.includes(bitmap)).toBe(true);
  });

  it("rejects mismatched bitmap size", () => {
    expect(() =>
      buildLabelJob(Buffer.alloc(10), /* widthBytes */ 50, /* heightDots */ 640),
    ).toThrow(/bitmap size/);
  });
});
