import { describe, it, expect, vi, beforeEach } from "vitest";

const updateMock = vi.fn();
const eqMock = vi.fn();
const selectMock = vi.fn();
const downloadMock = vi.fn();

// Controls what maybeSingle() returns for the clearOverride select path.
let maybeSingleResult: { data: unknown; error: null } = { data: null, error: null };

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
          eq: (..._eqArgs: unknown[]) => ({
            maybeSingle: () => Promise.resolve(maybeSingleResult),
          }),
        };
      },
    }),
    storage: { from: () => ({ download: downloadMock }) },
  })),
}));

import { setOverride, listPresetOverrides, clearOverride } from "./gallery-store";

beforeEach(() => { updateMock.mockClear(); eqMock.mockClear(); maybeSingleResult = { data: null, error: null }; });

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

describe("clearOverride", () => {
  it("returns {ok:false, reason:'not_found'} and does not update when row is missing", async () => {
    maybeSingleResult = { data: null, error: null };
    const result = await clearOverride("missing-hash");
    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns {ok:false, reason:'not_found'} and does NOT issue update for source='upload' row", async () => {
    maybeSingleResult = { data: { source: "upload" }, error: null };
    const result = await clearOverride("upload-hash");
    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("clears override_at and returns {ok:true} for source='builtin' row", async () => {
    maybeSingleResult = { data: { source: "builtin" }, error: null };
    const result = await clearOverride("builtin-hash");
    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith({ override_at: null });
    expect(eqMock).toHaveBeenCalledWith("hash", "builtin-hash");
  });
});
