// src/lib/cup-label/reprocess-api.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/cup-label/gallery-admin-auth", () => ({
  isAuthedGalleryAdmin: vi.fn(() => ({ ok: true })),
}));
const uploadArtifacts = vi.fn().mockResolvedValue(undefined);
const setOverrideMock = vi.fn().mockResolvedValue(undefined);
const loadSource = vi.fn();
vi.mock("@/lib/cup-label/gallery-store", () => ({
  uploadBucketArtifacts: (...a: unknown[]) => uploadArtifacts(...a),
  setOverride: (...a: unknown[]) => setOverrideMock(...a),
  loadSourceColor: (...a: unknown[]) => loadSource(...a),
}));
// Recipe + colorThumb return tiny fixed buffers so we assert flow, not pixels.
vi.mock("@/lib/cup-label/recipes", () => ({
  getRecipe: (id: string) => (id === "default" ? { id, label: "默认", run: async () => Buffer.from("BIN") } : null),
  colorThumb: async () => Buffer.from("COL"),
}));

import { POST } from "@/app/api/admin/gallery/reprocess/route";

function req(body: unknown) {
  return new Request("http://x/api/admin/gallery/reprocess", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

beforeEach(() => { uploadArtifacts.mockClear(); setOverrideMock.mockClear(); loadSource.mockReset(); });

describe("reprocess route", () => {
  it("preview from existing source writes nothing", async () => {
    loadSource.mockResolvedValue(Buffer.from("SRC"));
    const res = await POST(req({ hash: "abc", recipeId: "default" }));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.binarizedDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(uploadArtifacts).not.toHaveBeenCalled();
    expect(setOverrideMock).not.toHaveBeenCalled();
  });

  it("commit writes bucket artifacts then sets override", async () => {
    loadSource.mockResolvedValue(Buffer.from("SRC"));
    const res = await POST(req({ hash: "abc", recipeId: "default", commit: true }));
    expect((await res.json()).ok).toBe(true);
    expect(uploadArtifacts).toHaveBeenCalledWith("abc", Buffer.from("COL"), Buffer.from("BIN"));
    expect(setOverrideMock).toHaveBeenCalledWith("abc");
  });

  it("built-in cat with no source → 400 needs_upload", async () => {
    loadSource.mockResolvedValue(null);
    const res = await POST(req({ hash: "cat", recipeId: "default" }));
    expect(res.status).toBe(400);
    expect((await res.json()).reason).toBe("needs_upload");
  });

  it("uploaded image is used as source (no loadSourceColor)", async () => {
    const res = await POST(req({ hash: "cat", recipeId: "default", image: "data:image/png;base64,QUJD", commit: true }));
    expect((await res.json()).ok).toBe(true);
    expect(loadSource).not.toHaveBeenCalled();
    expect(uploadArtifacts).toHaveBeenCalled();
  });

  it("unknown recipe → 400 bad_recipe", async () => {
    loadSource.mockResolvedValue(Buffer.from("SRC"));
    const res = await POST(req({ hash: "abc", recipeId: "nope" }));
    expect(res.status).toBe(400);
    expect((await res.json()).reason).toBe("bad_recipe");
  });
});
