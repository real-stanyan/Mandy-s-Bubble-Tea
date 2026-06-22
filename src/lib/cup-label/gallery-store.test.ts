import { describe, it, expect, vi, beforeEach } from "vitest";

const rows: any[] = [];
const sb = {
  from: () => ({
    select: () => ({
      order: () => ({ then: (r: any) => r({ data: rows.filter((x) => !x.hidden && !x.deleted_at), error: null }) }),
    }),
    upsert: vi.fn(async () => ({ error: null })),
    update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
  }),
  storage: { from: () => ({ getPublicUrl: (p: string) => ({ data: { publicUrl: `https://cdn/${p}` } }) }) },
};
vi.mock("@/lib/supabase-server", () => ({ getSupabaseAdmin: () => sb }));

import { thumbUrlFor } from "./gallery-store";

beforeEach(() => { rows.length = 0; });

describe("gallery-store thumbUrlFor", () => {
  it("builtin gallery → /cup-label/gallery/ path (kind omitted defaults to gallery)", () => {
    expect(thumbUrlFor({ hash: "h1", source: "builtin", storage: "static" } as any))
      .toBe("/cup-label/gallery/h1/binarized.png");
  });
  it("builtin lucky_cat → /cup-label/lucky-cat/ path", () => {
    expect(thumbUrlFor({ hash: "c1", source: "builtin", storage: "static", kind: "lucky_cat" } as any))
      .toBe("/cup-label/lucky-cat/c1/binarized.png");
  });
  it("upload → bucket public binarized (print-effect) url", () => {
    expect(thumbUrlFor({ hash: "h2", source: "upload", storage: "supabase" } as any))
      .toBe("https://cdn/h2/binarized.png");
  });
  it("appends ?v= cache-bust from version (override_at) for bucket urls", () => {
    const url = thumbUrlFor({ hash: "h2", source: "upload", storage: "supabase", version: "2026-06-22T01:02:03.000Z" } as any);
    expect(url).toBe(`https://cdn/h2/binarized.png?v=${Date.parse("2026-06-22T01:02:03.000Z")}`);
  });
  it("does NOT append ?v= to static built-in paths", () => {
    expect(thumbUrlFor({ hash: "h1", source: "builtin", storage: "static", version: "2026-06-22T01:02:03.000Z" } as any))
      .toBe("/cup-label/gallery/h1/binarized.png");
  });
});
