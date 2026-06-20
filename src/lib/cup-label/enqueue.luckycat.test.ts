import { describe, it, expect, vi } from "vitest";
const pool = vi.fn(async () => ({ commons: ["c1", "c2"], hasRare: false }));
const diskScan = vi.fn(async () => ({ commons: ["disk1"], hasRare: false }));
vi.mock("./gallery-store", () => ({
  listLuckyCatPoolHashes: () => pool(),
  getLuckyCatBinarized: async () => Buffer.from("CAT"),
}));
import { luckyCatPool } from "./enqueue";

describe("luckyCatPool", () => {
  it("returns the DB pool when DB is healthy", async () => {
    pool.mockResolvedValueOnce({ commons: ["c1"], hasRare: true });
    expect(await luckyCatPool(diskScan)).toEqual({ commons: ["c1"], hasRare: true });
    expect(diskScan).not.toHaveBeenCalled();
  });
  it("falls back to the disk scan when the DB throws", async () => {
    pool.mockRejectedValueOnce(new Error("db down"));
    expect(await luckyCatPool(diskScan)).toEqual({ commons: ["disk1"], hasRare: false });
    expect(diskScan).toHaveBeenCalled();
  });
});
