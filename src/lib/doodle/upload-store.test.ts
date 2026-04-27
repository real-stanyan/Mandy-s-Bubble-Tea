import { describe, it, expect, vi, beforeEach } from "vitest";

const uploadMock = vi.fn();
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseAdmin: () => ({
    storage: {
      from: () => ({ upload: uploadMock }),
    },
  }),
}));

import { saveUserDoodleUpload, MAX_PATHS } from "./upload-store";

beforeEach(() => {
  uploadMock.mockReset();
  uploadMock.mockResolvedValue({ error: null });
});

describe("saveUserDoodleUpload", () => {
  const okPath = { d: "M0,0 L10,10", stroke: "#000", width: 3 };

  it("rejects when paths is empty", async () => {
    await expect(saveUserDoodleUpload({ userId: "u1", paths: [] }))
      .rejects.toThrow(/at least one path/);
  });

  it(`rejects when paths exceeds MAX_PATHS (${200})`, async () => {
    const many = Array(201).fill(okPath);
    await expect(saveUserDoodleUpload({ userId: "u1", paths: many }))
      .rejects.toThrow(/too many paths/);
  });

  it("rejects malformed path entries", async () => {
    const bad = { d: "<script>", stroke: "#000", width: 3 } as never;
    await expect(saveUserDoodleUpload({ userId: "u1", paths: [bad] }))
      .rejects.toThrow(/disallowed characters/);
  });

  it("stores valid paths and returns a doodleId", async () => {
    const out = await saveUserDoodleUpload({ userId: "u1", paths: [okPath] });
    expect(out.doodleId).toMatch(/^[0-9a-f-]{36}$/);
    expect(uploadMock).toHaveBeenCalledTimes(1);
    const [path, body, opts] = uploadMock.mock.calls[0];
    expect(path).toBe(`u1/${out.doodleId}.json`);
    expect(opts.contentType).toBe("application/json");
    expect(JSON.parse(body.toString())).toEqual({ paths: [okPath] });
  });

  it("propagates storage errors", async () => {
    uploadMock.mockResolvedValue({ error: { message: "disk full" } });
    await expect(saveUserDoodleUpload({ userId: "u1", paths: [okPath] }))
      .rejects.toThrow(/disk full/);
  });
});
