import { describe, it, expect, vi } from "vitest";

const { fsRead, bucketDl } = vi.hoisted(() => ({
  fsRead: vi.fn(),
  bucketDl: vi.fn(async () => Buffer.from("BUCKET")),
}));

vi.mock("node:fs", () => ({ promises: { readFile: fsRead } }));
vi.mock("./gallery-store", () => ({
  downloadBucketBinarized: () => bucketDl(),
}));

import { resolvePresetBuffer } from "./enqueue";

describe("resolvePresetBuffer", () => {
  it("builtin hash → disk read, bucket NOT called", async () => {
    fsRead.mockResolvedValueOnce(Buffer.from("DISK"));
    const result = await resolvePresetBuffer("b".repeat(32));
    expect(result.toString()).toBe("DISK");
    expect(bucketDl).not.toHaveBeenCalled();
  });

  it("upload hash (not on disk) → falls through to bucket", async () => {
    fsRead.mockRejectedValueOnce(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    const result = await resolvePresetBuffer("u".repeat(32));
    expect(result.toString()).toBe("BUCKET");
    expect(bucketDl).toHaveBeenCalled();
  });
});
