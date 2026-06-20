import { describe, it, expect, vi } from "vitest";

const { fsRead } = vi.hoisted(() => ({
  fsRead: vi.fn(async () => Buffer.from("DISK")),
}));

vi.mock("node:fs", () => ({ promises: { readFile: fsRead } }));
vi.mock("@/lib/cup-label/lucky-cat", () => ({ RARE_LUCKY_CAT_HASH: "RARE" }));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseAdmin: () => ({}) }));
// downloadBucketBinarized is in the same module under test; we drive it via the disk-miss path.

import { splitLuckyCatPool, getLuckyCatBinarized } from "./gallery-store";

describe("lucky-cat pool", () => {
  it("splitLuckyCatPool separates rare from commons", () => {
    expect(splitLuckyCatPool(["a", "RARE", "b"])).toEqual({ commons: ["a", "b"], hasRare: true });
    expect(splitLuckyCatPool(["a", "b"])).toEqual({ commons: ["a", "b"], hasRare: false });
  });

  it("getLuckyCatBinarized reads disk first", async () => {
    fsRead.mockResolvedValueOnce(Buffer.from("DISK"));
    expect((await getLuckyCatBinarized("h")).toString()).toBe("DISK");
  });
});
