import { describe, it, expect, beforeEach, vi } from "vitest";
vi.mock("@/lib/cup-label/gallery-admin-auth", () => ({ isAuthedGalleryAdmin: () => ({ ok: true }) }));
import sharp from "sharp";
import { POST } from "./route";

async function redB64() {
  const buf = await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 200, g: 20, b: 20 } } }).png().toBuffer();
  return `data:image/png;base64,${buf.toString("base64")}`;
}

beforeEach(() => { process.env.GALLERY_ADMIN_TOKEN = "t"; });

describe("POST preview", () => {
  it("returns hash + data URLs per image without persisting", async () => {
    const body = JSON.stringify({ images: [await redB64()] });
    const res = await POST(new Request("http://x/api/admin/gallery/preview", { method: "POST", body }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.results[0].hash).toMatch(/^[a-f0-9]{32}$/);
    expect(json.results[0].binarizedDataUrl).toContain("data:image/png;base64,");
  });
});
