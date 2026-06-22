import { describe, it, expect, beforeEach, vi } from "vitest";

let authed = true;
vi.mock("@/lib/cup-label/gallery-admin-auth", () => ({
  isAuthedGalleryAdmin: () => (authed ? { ok: true } : { ok: false, reason: "unauthorized" }),
}));

const generateMock = vi.fn(async (..._a: unknown[]) => Buffer.from("PNGBYTES"));
vi.mock("@/lib/cup-label/minimax-image", () => ({
  generateGalleryImage: (...a: unknown[]) => generateMock(...a),
}));

import { POST } from "./route";

function req(body: unknown): Request {
  return new Request("http://x/api/admin/gallery/ai-generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  authed = true;
  generateMock.mockClear();
  process.env.GALLERY_ADMIN_TOKEN = "t";
});

describe("ai-generate route", () => {
  it("401 when unauthorized", async () => {
    authed = false;
    const res = await POST(req({ prompt: "a cat" }));
    expect(res.status).toBe(401);
  });

  it("400 when prompt missing", async () => {
    const res = await POST(req({ mode: "text" }));
    expect(res.status).toBe(400);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("400 when image mode without a reference image", async () => {
    const res = await POST(req({ mode: "image", prompt: "a cat" }));
    expect(res.status).toBe(400);
  });

  it("text mode returns a data-uri image", async () => {
    const res = await POST(req({ mode: "text", prompt: "a peach" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.image).toMatch(/^data:image\/png;base64,/);
    expect(generateMock).toHaveBeenCalledWith(expect.objectContaining({ mode: "text", prompt: "a peach" }));
  });

  it("image mode forwards the decoded reference buffer", async () => {
    const dataUri = "data:image/png;base64,aGVsbG8="; // "hello"
    const res = await POST(req({ mode: "image", prompt: "a cat", image: dataUri }));
    expect(res.status).toBe(200);
    const arg = generateMock.mock.calls[0][0] as { mode: string; refImage?: Buffer };
    expect(arg.mode).toBe("image");
    expect(Buffer.isBuffer(arg.refImage)).toBe(true);
  });

  it("502 when generation throws", async () => {
    generateMock.mockRejectedValueOnce(new Error("MiniMax HTTP 500"));
    const res = await POST(req({ mode: "text", prompt: "a cat" }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/MiniMax/);
  });
});
