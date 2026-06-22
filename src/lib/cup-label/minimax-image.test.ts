import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import sharp from "sharp";
import { buildGalleryPrompt, generateGalleryImage } from "./minimax-image";

// A tiny but valid PNG the mocked "download" step can hand back to sharp.
async function tinyPng(): Promise<Buffer> {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 10, b: 10 } } })
    .png()
    .toBuffer();
}

describe("buildGalleryPrompt", () => {
  it("embeds the subject and forces the line-art / white-bg style", () => {
    const p = buildGalleryPrompt("  a smiling boba cup  ");
    expect(p).toContain("a smiling boba cup");
    expect(p).toMatch(/black line art/i);
    expect(p).toMatch(/pure white background/i);
    expect(p).toMatch(/no shading/i);
  });
});

describe("generateGalleryImage", () => {
  const realFetch = global.fetch;
  let calls: Array<{ url: string; init?: RequestInit }>;

  beforeEach(() => {
    process.env.MINIMAX_API_KEY = "sk-cp-test";
    calls = [];
  });
  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  function mockFetch(png: Buffer, opts?: { statusCode?: number }) {
    global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = typeof url === "string" ? url : url.toString();
      calls.push({ url: u, init });
      if (u.includes("/v1/image_generation")) {
        return new Response(
          JSON.stringify({
            data: { image_urls: ["https://oss.example/img.png"] },
            base_resp: { status_code: opts?.statusCode ?? 0, status_msg: "ok" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      // image download
      return new Response(new Uint8Array(png), { status: 200, headers: { "content-type": "image/png" } });
    }) as unknown as typeof fetch;
  }

  it("text mode posts model image-01 with a white-canvas anchor and returns a PNG", async () => {
    mockFetch(await tinyPng());
    const out = await generateGalleryImage({ mode: "text", prompt: "a peach" });
    expect(Buffer.isBuffer(out)).toBe(true);
    expect((await sharp(out).metadata()).format).toBe("png");

    const gen = calls.find((c) => c.url.includes("/v1/image_generation"))!;
    const body = JSON.parse(gen.init!.body as string);
    expect(body.model).toBe("image-01");
    expect(body.image_url).toMatch(/^data:image\/png;base64,/); // white anchor
    expect(body.prompt).toContain("a peach");
    expect((gen.init!.headers as Record<string, string>).Authorization).toBe("Bearer sk-cp-test");
  });

  it("image mode sends the caller's reference as the image_url", async () => {
    mockFetch(await tinyPng());
    const ref = await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 250, g: 0, b: 0 } } })
      .png()
      .toBuffer();
    await generateGalleryImage({ mode: "image", prompt: "a cat", refImage: ref });
    const body = JSON.parse(calls.find((c) => c.url.includes("/v1/image_generation"))!.init!.body as string);
    expect(body.model).toBe("image-01");
    expect(body.image_url).toMatch(/^data:image\/png;base64,/);
  });

  it("throws when the API key is missing", async () => {
    delete process.env.MINIMAX_API_KEY;
    await expect(generateGalleryImage({ mode: "text", prompt: "x" })).rejects.toThrow(/MINIMAX_API_KEY/);
  });

  it("throws on a MiniMax error status_code", async () => {
    mockFetch(await tinyPng(), { statusCode: 1004 });
    await expect(generateGalleryImage({ mode: "text", prompt: "x" })).rejects.toThrow(/MiniMax error 1004/);
  });
});
