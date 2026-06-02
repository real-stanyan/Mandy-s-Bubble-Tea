import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getSupabaseAdmin } from "@/lib/supabase-server";
import { generateFortunes, __test__ } from "./fortune";

const mockAdmin = vi.mocked(getSupabaseAdmin);

function fakeClient(rpcReturn: { data: Array<{ text: string }> | null; error: { message: string } | null }) {
  return {
    rpc: vi.fn().mockResolvedValue(rpcReturn),
  } as unknown as ReturnType<typeof getSupabaseAdmin>;
}

describe("generateFortunes (DB-backed)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns RPC rows when RPC succeeds and supplies enough", async () => {
    const rows = [
      { text: "The next sip will taste better than the last" },
      { text: "Today carries small wonders worth a slow sip" },
      { text: "Slow sips make for long memories" },
    ];
    mockAdmin.mockReturnValue(fakeClient({ data: rows, error: null }));

    const out = await generateFortunes(3);

    expect(out).toEqual(rows.map((r) => r.text));
    const client = mockAdmin.mock.results[0]!.value;
    expect(client.rpc).toHaveBeenCalledWith("cup_label_random_fortunes", { n: 3 });
  });

  it("falls back to pool when RPC returns fewer rows than requested", async () => {
    const rows = [{ text: "A single short return" }];
    mockAdmin.mockReturnValue(fakeClient({ data: rows, error: null }));

    const out = await generateFortunes(5);

    expect(out).toHaveLength(5);
    const pool = new Set(__test__.FALLBACK_POOL);
    expect(out.every((l) => pool.has(l))).toBe(true);
  });

  it("falls back to pool when RPC returns an error", async () => {
    mockAdmin.mockReturnValue(fakeClient({ data: null, error: { message: "connection refused" } }));

    const out = await generateFortunes(2);

    expect(out).toHaveLength(2);
    const pool = new Set(__test__.FALLBACK_POOL);
    expect(out.every((l) => pool.has(l))).toBe(true);
  });

  it("returns empty array when count <= 0", async () => {
    const out = await generateFortunes(0);
    expect(out).toEqual([]);
  });
});

describe("isSafeFortune", () => {
  it("rejects forbidden topics", () => {
    expect(__test__.isSafeFortune("A loved one will call you tomorrow")).toBe(false);
    expect(__test__.isSafeFortune("God smiles upon your endeavor")).toBe(false);
    expect(__test__.isSafeFortune("You will lose something dear today")).toBe(false);
  });
  it("accepts neutral warm lines", () => {
    expect(__test__.isSafeFortune("A warm smile makes any day sweeter")).toBe(true);
    expect(__test__.isSafeFortune("Every sip is a little moment of calm")).toBe(true);
  });
  it("rejects imperative starts", () => {
    expect(__test__.isSafeFortune("Beware of strangers offering candy")).toBe(false);
    expect(__test__.isSafeFortune("Do not look back today")).toBe(false);
  });
  it("rejects questions", () => {
    expect(__test__.isSafeFortune("Why not try something new today")).toBe(false);
  });
});

describe("pickFromPool", () => {
  it("returns the requested count even when count exceeds pool size", () => {
    const out = __test__.pickFromPool(50);
    expect(out).toHaveLength(50);
  });
  it("excludes already-used lines when caller supplies them", () => {
    const exclude = __test__.FALLBACK_POOL.slice(0, 5);
    const out = __test__.pickFromPool(5, exclude);
    expect(out.every((l) => !exclude.includes(l))).toBe(true);
  });
});
