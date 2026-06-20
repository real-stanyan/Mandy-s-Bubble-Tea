import { describe, it, expect, beforeEach, vi } from "vitest";
vi.mock("@/lib/cup-label/gallery-admin-auth", () => ({ isAuthedGalleryAdmin: () => ({ ok: true }) }));
const uploads: string[] = [];
const inserts: string[] = [];
vi.mock("@/lib/cup-label/gallery-store", () => ({
  uploadBucketArtifacts: async (h: string) => { uploads.push(h); },
  insertUploadPreset: async (h: string) => { inserts.push(h); },
}));
import sharp from "sharp";
import { createHash } from "node:crypto";
import { POST } from "./route";

beforeEach(() => { process.env.GALLERY_ADMIN_TOKEN = "t"; uploads.length = 0; inserts.length = 0; });

async function img() {
  const buf = await sharp({ create: { width: 24, height: 24, channels: 3, background: { r: 10, g: 200, b: 50 } } }).png().toBuffer();
  return { image: `data:image/png;base64,${buf.toString("base64")}`, hash: createHash("md5").update(buf).digest("hex") };
}

describe("POST commit", () => {
  it("commits when claimed hash matches recomputed", async () => {
    const body = JSON.stringify({ images: [await img()] });
    const res = await POST(new Request("http://x", { method: "POST", body }));
    const json = await res.json();
    expect(json.committed).toHaveLength(1);
    expect(uploads).toHaveLength(1);
    expect(inserts).toHaveLength(1);
  });
  it("rejects hash mismatch", async () => {
    const one = await img();
    const body = JSON.stringify({ images: [{ image: one.image, hash: "deadbeef".repeat(4) }] });
    const res = await POST(new Request("http://x", { method: "POST", body }));
    const json = await res.json();
    expect(json.committed).toHaveLength(0);
    expect(json.failed[0].error).toContain("hash mismatch");
  });
});
