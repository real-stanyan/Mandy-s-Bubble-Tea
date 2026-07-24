import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  getSupabaseAdmin: vi.fn(() => ({
    storage: {
      from: () => ({
        getPublicUrl: (p: string) => ({ data: { publicUrl: `https://buck/${p}` } }),
      }),
    },
  })),
}));

import { thumbUrlFor } from "./gallery-store";

describe("thumbUrlFor override", () => {
  it("builtin without override → disk seed", () => {
    expect(thumbUrlFor({ hash: "abc", source: "builtin", kind: "gallery" }))
      .toBe("/cup-label/gallery/abc/binarized.png");
  });
  it("builtin lucky_cat without override → lucky-cat disk dir", () => {
    expect(thumbUrlFor({ hash: "cat", source: "builtin", kind: "lucky_cat" }))
      .toBe("/cup-label/lucky-cat/cat/binarized.png");
  });
  it("builtin WITH override → bucket binarized.png", () => {
    expect(thumbUrlFor({ hash: "abc", source: "builtin", kind: "gallery", hasOverride: true }))
      .toBe("https://buck/abc/binarized.png");
  });
  it("upload → bucket binarized.png (WYSIWYG print effect; override ignored)", () => {
    // Upload thumbnails show the binarized print image (what prints on the cup),
    // not the colour source — see feat(gallery) fa41785a.
    expect(thumbUrlFor({ hash: "up", source: "upload", hasOverride: true }))
      .toBe("https://buck/up/binarized.png");
  });
});
