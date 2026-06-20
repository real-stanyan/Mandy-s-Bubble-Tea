import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/cup-label/gallery-admin-auth", () => ({
  isAuthedGalleryAdmin: () => ({ ok: true }),
}));

const calls: any = {};
vi.mock("@/lib/cup-label/gallery-store", () => ({
  setHidden: async (h: string, v: boolean) => {
    calls.hidden = [h, v];
  },
  softDeleteUpload: async (h: string) =>
    h === "builtinhash"
      ? { ok: false, reason: "builtin_not_deletable" }
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

  it("DELETE builtin → 409", async () => {
    const res = await DELETE(
      new Request("http://x", { method: "DELETE" }),
      { params: Promise.resolve({ hash: "builtinhash" }) }
    );
    expect(res.status).toBe(409);
  });
});
