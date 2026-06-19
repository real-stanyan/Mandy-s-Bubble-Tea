import { describe, it, expect, vi } from "vitest";

const { fsRead, sourceOf, bucketDl } = vi.hoisted(() => ({
  fsRead: vi.fn(async () => Buffer.from("DISK")),
  sourceOf: vi.fn(async (h: string) => (h === "u".repeat(32) ? "upload" : "builtin")),
  bucketDl: vi.fn(async () => Buffer.from("BUCKET")),
}));

vi.mock("node:fs", () => ({ promises: { readFile: fsRead } }));
vi.mock("./gallery-store", () => ({
  getPresetSource: (h: string) => sourceOf(h),
  downloadBucketBinarized: () => bucketDl(),
}));

import { resolvePresetBuffer } from "./enqueue";

describe("resolvePresetBuffer", () => {
  it("upload hash → bucket download", async () => {
    expect((await resolvePresetBuffer("u".repeat(32))).toString()).toBe("BUCKET");
    expect(bucketDl).toHaveBeenCalled();
  });
  it("builtin hash → disk read", async () => {
    expect((await resolvePresetBuffer("b".repeat(32))).toString()).toBe("DISK");
    expect(fsRead).toHaveBeenCalled();
  });
});
