import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: any = {};
function makeSb() {
  return {
    from: () => ({
      select: (cols: string) => {
        calls.select = cols;
        const chain: any = {
          eq: (k: string, v: any) => { (calls.eq ||= []).push([k, v]); return chain; },
          is: (k: string, v: any) => { (calls.is ||= []).push([k, v]); return chain; },
          order: () => Promise.resolve({ data: calls._rows ?? [], error: null }),
          maybeSingle: () => Promise.resolve({ data: calls._single ?? null, error: null }),
        };
        return chain;
      },
      update: (patch: any) => { calls.update = patch; return { eq: () => Promise.resolve({ error: null }) }; },
      upsert: (row: any) => { calls.upsert = row; return Promise.resolve({ error: null }); },
    }),
    storage: { from: () => ({ getPublicUrl: (p: string) => ({ data: { publicUrl: `https://cdn/${p}` } }) }) },
  };
}
let sb: any;
vi.mock("@/lib/supabase-server", () => ({ getSupabaseAdmin: () => sb }));

import { listVisiblePresets, insertUploadPreset, softDeletePreset, listAllForAdmin } from "./gallery-store";

beforeEach(() => { for (const k in calls) delete calls[k]; sb = makeSb(); });

describe("gallery-store v2", () => {
  it("listVisiblePresets filters kind=gallery", async () => {
    calls._rows = [];
    await listVisiblePresets();
    expect(calls.eq).toContainEqual(["kind", "gallery"]);
    expect(calls.eq).toContainEqual(["hidden", false]);
  });

  it("insertUploadPreset defaults kind=gallery and accepts lucky_cat", async () => {
    await insertUploadPreset("h", "admin");
    expect(calls.upsert.kind).toBe("gallery");
    await insertUploadPreset("h2", "admin", "lucky_cat");
    expect(calls.upsert.kind).toBe("lucky_cat");
  });

  it("softDeletePreset soft-deletes a builtin (no refusal)", async () => {
    calls._single = { source: "builtin" };
    const r = await softDeletePreset("h");
    expect(r).toEqual({ ok: true });
    expect(calls.update.deleted_at).toBeTypeOf("string");
    expect(calls.update.hidden).toBe(true);
  });

  it("softDeletePreset returns not_found when missing", async () => {
    calls._single = null;
    expect(await softDeletePreset("h")).toEqual({ ok: false, reason: "not_found" });
  });

  it("listAllForAdmin filters deleted-at null and includes kind", async () => {
    calls._rows = [{ hash: "h1", source: "builtin", storage: "static", hidden: false, sort_order: 0, deleted_at: null, kind: "lucky_cat" }];
    const result = await listAllForAdmin();
    expect(calls.is).toContainEqual(["deleted_at", null]);
    expect(result[0].kind).toBe("lucky_cat");
    expect(result[0].thumbUrl).toBeDefined();
    expect(result[0].hidden).toBe(false);
  });
});
