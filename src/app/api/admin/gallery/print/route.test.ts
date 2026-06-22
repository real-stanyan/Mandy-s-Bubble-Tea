import { describe, it, expect, beforeEach, vi } from "vitest";

let authed = true;
vi.mock("@/lib/cup-label/gallery-admin-auth", () => ({
  isAuthedGalleryAdmin: () => (authed ? { ok: true } : { ok: false, reason: "unauthorized" }),
}));

vi.mock("@/lib/cup-label/enqueue", () => ({
  resolvePresetBuffer: vi.fn(async () => Buffer.from("PNG")),
}));

const renderMock = vi.fn(async (..._a: unknown[]) => ({ zpl: "^XA...^XZ", previewPng: Buffer.from("") }));
vi.mock("@/lib/cup-label/render-zebra-cup", () => ({
  renderCupLabel: (...a: unknown[]) => renderMock(...a),
}));

// Supabase admin: lookup gallery_presets, then insert cup_label_jobs.
let presetRow: { hash: string; override_at: string | null; deleted_at: string | null } | null = {
  hash: "abc123", override_at: null, deleted_at: null,
};
let insertError: { message: string } | null = null;
const insertSpy = vi.fn();
vi.mock("@/lib/supabase-server", () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      if (table === "gallery_presets") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: presetRow, error: null }) }) }) };
      }
      // cup_label_jobs
      return {
        insert(row: unknown) {
          insertSpy(row);
          return { select: () => ({ single: async () => ({ data: { id: "job-1" }, error: insertError }) }) };
        },
      };
    },
  }),
}));

import { POST } from "./route";

function req(body: unknown): Request {
  return new Request("http://x/api/admin/gallery/print", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  authed = true;
  presetRow = { hash: "abc123", override_at: null, deleted_at: null };
  insertError = null;
  insertSpy.mockClear();
  renderMock.mockClear();
});

describe("gallery print route", () => {
  it("401 when unauthorized", async () => {
    authed = false;
    expect((await POST(req({ hash: "abc123" }))).status).toBe(401);
  });

  it("400 on bad hash", async () => {
    expect((await POST(req({ hash: "bad hash!" }))).status).toBe(400);
    expect((await POST(req({}))).status).toBe(400);
  });

  it("404 when preset missing or soft-deleted", async () => {
    presetRow = null;
    expect((await POST(req({ hash: "abc123" }))).status).toBe(404);
    presetRow = { hash: "abc123", override_at: null, deleted_at: "2026-01-01" };
    expect((await POST(req({ hash: "abc123" }))).status).toBe(404);
  });

  it("enqueues a zd410 job with inline zpl_body and returns jobId", async () => {
    const res = await POST(req({ hash: "abc123" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, jobId: "job-1" });
    const row = insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(row.target_printer_kind).toBe("zd410");
    expect(row.zpl_body).toBe("^XA...^XZ");
    expect(row.doodle_source).toBe("preset_sticker");
    expect(row.cup_idx).toBe(0);
    expect(String(row.square_order_id)).toMatch(/^gallery-test-abc123/);
  });

  it("passes the override flag to the buffer resolver", async () => {
    const { resolvePresetBuffer } = await import("@/lib/cup-label/enqueue");
    presetRow = { hash: "abc123", override_at: "2026-06-01T00:00:00Z", deleted_at: null };
    await POST(req({ hash: "abc123" }));
    expect(resolvePresetBuffer).toHaveBeenCalledWith("abc123", { hasOverride: true });
  });

  it("500 when the insert fails", async () => {
    insertError = { message: "db down" };
    expect((await POST(req({ hash: "abc123" }))).status).toBe(500);
  });
});
