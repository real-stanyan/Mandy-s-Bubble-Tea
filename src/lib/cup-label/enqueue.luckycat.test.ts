import { describe, it, expect, vi } from "vitest";
const pool = vi.fn(async () => ({ commons: ["c1", "c2"], hasRare: false, overrides: new Set<string>() }));
const diskScan = vi.fn(async () => ({ commons: ["disk1"], hasRare: false, overrides: new Set<string>() }));
vi.mock("./gallery-store", () => ({
  listLuckyCatPoolHashes: () => pool(),
  getLuckyCatBinarized: async () => Buffer.from("CAT"),
}));
import { luckyCatPool } from "./enqueue";

describe("luckyCatPool", () => {
  it("returns the DB pool when DB is healthy", async () => {
    pool.mockResolvedValueOnce({ commons: ["c1"], hasRare: true, overrides: new Set<string>() });
    expect(await luckyCatPool(diskScan)).toEqual({ commons: ["c1"], hasRare: true, overrides: new Set() });
    expect(diskScan).not.toHaveBeenCalled();
  });
  it("falls back to the disk scan when the DB throws", async () => {
    pool.mockRejectedValueOnce(new Error("db down"));
    expect(await luckyCatPool(diskScan)).toEqual({ commons: ["disk1"], hasRare: false, overrides: new Set() });
    expect(diskScan).toHaveBeenCalled();
  });
});
