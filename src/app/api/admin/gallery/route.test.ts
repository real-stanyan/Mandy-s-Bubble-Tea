import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/cup-label/gallery-admin-auth", () => ({
  isAuthedGalleryAdmin: () => ({ ok: true }),
}));

vi.mock("@/lib/cup-label/gallery-store", () => ({
  listAllForAdmin: async () => [
    {
      hash: "h1",
      source: "builtin",
      thumbUrl: "/x",
      hidden: false,
      deletedAt: null,
    },
  ],
}));

import { GET } from "./route";

beforeEach(() => {
  process.env.GALLERY_ADMIN_TOKEN = "t";
});

describe("gallery route", () => {
  it("GET returns presets", async () => {
    const res = await GET(new Request("http://x"));
    expect((await res.json()).presets).toHaveLength(1);
  });
});
