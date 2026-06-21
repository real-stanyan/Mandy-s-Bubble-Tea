import { describe, it, expect, vi, beforeEach } from "vitest";

const readFileMock = vi.fn();
vi.mock("node:fs", () => ({ promises: { readFile: (...a: unknown[]) => readFileMock(...a) } }));
const downloadBin = vi.fn();
vi.mock("./gallery-store", () => ({
  downloadBucketBinarized: (...a: unknown[]) => downloadBin(...a),
  listLuckyCatPoolHashes: vi.fn(),
  getLuckyCatBinarized: vi.fn(),
}));

import { resolvePresetBuffer } from "./enqueue";

beforeEach(() => { readFileMock.mockReset(); downloadBin.mockReset(); });

describe("resolvePresetBuffer override", () => {
  it("override → reads bucket, never disk", async () => {
    downloadBin.mockResolvedValue(Buffer.from("BUCKET"));
    const out = await resolvePresetBuffer("abc", { hasOverride: true });
    expect(out.toString()).toBe("BUCKET");
    expect(readFileMock).not.toHaveBeenCalled();
  });
  it("no override → disk first", async () => {
    readFileMock.mockResolvedValue(Buffer.from("DISK"));
    const out = await resolvePresetBuffer("abc");
    expect(out.toString()).toBe("DISK");
  });
  it("no override, disk miss → bucket fallback", async () => {
    readFileMock.mockRejectedValue(new Error("ENOENT"));
    downloadBin.mockResolvedValue(Buffer.from("BUCKET"));
    const out = await resolvePresetBuffer("abc");
    expect(out.toString()).toBe("BUCKET");
  });
});
