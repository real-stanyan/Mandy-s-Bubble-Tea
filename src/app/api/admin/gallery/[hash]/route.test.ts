import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/cup-label/gallery-admin-auth", () => ({
  isAuthedGalleryAdmin: () => ({ ok: true }),
}));

const calls: any = {};
vi.mock("@/lib/cup-label/gallery-store", () => ({
  setHidden: async (h: string, v: boolean) => {
    calls.hidden = [h, v];
  },
  softDeletePreset: async (h: string) =>
    h === "missing"
      ? { ok: false, reason: "not_found" }
      : { ok: true },
}));

import { PATCH, DELETE } from "./route";

beforeEach(() => {
  process.env.GALLERY_ADMIN_TOKEN = "t";
});

describe("[hash] route", () => {
  it("PATCH sets hidden", async () => {
    const res = await PATCH(
      new Request("http://x", {
        method: "PATCH",
        body: JSON.stringify({ hidden: true }),
      }),
      { params: Promise.resolve({ hash: "h1" }) }
    );
    expect((await res.json()).ok).toBe(true);
    expect(calls.hidden).toEqual(["h1", true]);
  });

  it("DELETE soft-deletes any preset (incl. builtin) → 200", async () => {
    const res = await DELETE(
      new Request("http://x", { method: "DELETE" }),
      { params: Promise.resolve({ hash: "anyhash" }) }
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("DELETE missing → 404", async () => {
    const res = await DELETE(
      new Request("http://x", { method: "DELETE" }),
      { params: Promise.resolve({ hash: "missing" }) }
    );
    expect(res.status).toBe(404);
  });
});
