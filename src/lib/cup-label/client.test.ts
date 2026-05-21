import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readFileAsDataUri,
  uploadPhotoForCupLabel,
  submitAiCupLabel,
  CupLabelClientError,
} from "./client";

let fetchSpy: ReturnType<typeof vi.spyOn>;

function mockFetchOnce(body: object, status = 200) {
  fetchSpy.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe("readFileAsDataUri", () => {
  it("returns a data: URI", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "x.png", { type: "image/png" });
    const uri = await readFileAsDataUri(file);
    expect(uri).toMatch(/^data:image\/png;base64,/);
  });
});

describe("uploadPhotoForCupLabel", () => {
  it("POSTs the data URI and returns the uploadedDoodleId + previewUrl", async () => {
    mockFetchOnce({
      ok: true,
      uploadedDoodleId: "11111111-2222-3333-4444-555555555555",
      previewUrl: "https://example/preview.png",
    });
    const file = new File([new Uint8Array([1, 2, 3])], "x.png", { type: "image/png" });
    const result = await uploadPhotoForCupLabel(file);
    expect(result).toEqual({
      uploadedDoodleId: "11111111-2222-3333-4444-555555555555",
      previewUrl: "https://example/preview.png",
    });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/cup-label/upload-image");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string).imageBase64).toMatch(/^data:image\/png;base64,/);
  });

  it("rejects files larger than 8 MB before POSTing", async () => {
    const big = new File([new Uint8Array(9 * 1024 * 1024)], "big.jpg", { type: "image/jpeg" });
    await expect(uploadPhotoForCupLabel(big)).rejects.toThrow(/too large/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws CupLabelClientError on server 4xx", async () => {
    mockFetchOnce({ ok: false, error: "Sign in required" }, 401);
    const file = new File([new Uint8Array([1])], "x.png", { type: "image/png" });
    await expect(uploadPhotoForCupLabel(file)).rejects.toBeInstanceOf(CupLabelClientError);
  });
});

describe("submitAiCupLabel", () => {
  it("POSTs the prompt + cartSessionId and returns the aiDoodleId", async () => {
    mockFetchOnce({
      ok: true,
      aiDoodleId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      status: "pending",
      reused: false,
    });
    const result = await submitAiCupLabel({
      slotKey: "VAR::MOD:0",
      prompt: "cats reading on a moon",
      cartSessionId: "session-uuid-here",
    });
    expect(result.aiDoodleId).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(result.reused).toBe(false);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      slotKey: "VAR::MOD:0",
      prompt: "cats reading on a moon",
      cartSessionId: "session-uuid-here",
    });
  });

  it("includes sourceImageBase64 when provided", async () => {
    mockFetchOnce({ ok: true, aiDoodleId: "id", status: "pending", reused: false });
    await submitAiCupLabel({
      slotKey: "VAR:::0",
      prompt: "p",
      cartSessionId: "s",
      sourceImageBase64: "data:image/png;base64,AAA",
    });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.sourceImageBase64).toBe("data:image/png;base64,AAA");
  });

  it("rejects empty prompt without POSTing", async () => {
    await expect(
      submitAiCupLabel({ slotKey: "VAR:::0", prompt: "   ", cartSessionId: "s" }),
    ).rejects.toThrow(/empty/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects prompt over 200 chars without POSTing", async () => {
    await expect(
      submitAiCupLabel({ slotKey: "VAR:::0", prompt: "x".repeat(201), cartSessionId: "s" }),
    ).rejects.toThrow(/too long/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws CupLabelClientError on server error", async () => {
    mockFetchOnce({ ok: false, error: "Quota exhausted" }, 429);
    await expect(
      submitAiCupLabel({ slotKey: "VAR:::0", prompt: "p", cartSessionId: "s" }),
    ).rejects.toBeInstanceOf(CupLabelClientError);
  });
});
