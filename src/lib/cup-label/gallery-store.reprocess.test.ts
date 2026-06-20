import { describe, it, expect, vi, beforeEach } from "vitest";

const updateMock = vi.fn();
const eqMock = vi.fn();
const selectMock = vi.fn();
const downloadMock = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  getSupabaseAdmin: vi.fn(() => ({
    from: () => ({
      update: (v: unknown) => { updateMock(v); return { eq: (...a: unknown[]) => { eqMock(...a); return Promise.resolve({ error: null }); } }; },
      select: (...a: unknown[]) => {
        selectMock(...a);
        return {
          not: () => ({
            in: (_c: string, hs: string[]) =>
              Promise.resolve({ data: hs.filter((h) => h === "ov").map((h) => ({ hash: h })), error: null }),
          }),
        };
      },
    }),
    storage: { from: () => ({ download: downloadMock }) },
  })),
}));

import { setOverride, listPresetOverrides } from "./gallery-store";

beforeEach(() => { updateMock.mockClear(); eqMock.mockClear(); });

describe("override write helpers", () => {
  it("setOverride sets override_at and filters by hash", async () => {
    await setOverride("abc");
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ override_at: expect.any(String) }));
    expect(eqMock).toHaveBeenCalledWith("hash", "abc");
  });

  it("listPresetOverrides returns only overridden hashes", async () => {
    const set = await listPresetOverrides(["ov", "plain"]);
    expect(set.has("ov")).toBe(true);
    expect(set.has("plain")).toBe(false);
  });

  it("listPresetOverrides short-circuits on empty input", async () => {
    selectMock.mockClear();
    const set = await listPresetOverrides([]);
    expect(set.size).toBe(0);
    expect(selectMock).not.toHaveBeenCalled();
  });
});
