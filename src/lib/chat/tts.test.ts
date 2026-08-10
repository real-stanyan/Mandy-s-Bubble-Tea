import { describe, it, expect, vi, afterEach } from "vitest";
import {
  languageBoostFor,
  ttsCacheKey,
  hexToBuffer,
  synthesizeSpeech,
  TtsError,
} from "./tts";

describe("languageBoostFor", () => {
  it("routes each script to its language", () => {
    expect(languageBoostFor("来一杯芋头奶茶")).toBe("Chinese");
    expect(languageBoostFor("こんにちは、Mandyです")).toBe("Japanese");
    expect(languageBoostFor("안녕하세요 Mandy예요")).toBe("Korean");
    expect(languageBoostFor("Hi, I'm Mandy!")).toBe("English");
  });

  it("kana wins over Han — Japanese sentences carry both", () => {
    expect(languageBoostFor("今週のおすすめは芋頭ミルクティー")).toBe("Japanese");
  });
});

describe("ttsCacheKey", () => {
  it("is stable for the same text and distinct for different text", () => {
    expect(ttsCacheKey("hello")).toBe(ttsCacheKey("hello"));
    expect(ttsCacheKey("hello")).not.toBe(ttsCacheKey("hello!"));
    expect(ttsCacheKey("hello")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("hexToBuffer", () => {
  it("round-trips hex", () => {
    expect(hexToBuffer("48656c6c6f").toString("utf8")).toBe("Hello");
  });
});

describe("synthesizeSpeech", () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  afterEach(() => {
    fetchMock.mockReset();
    delete process.env.MINIMAX_API_KEY;
  });

  it("throws without an API key", async () => {
    await expect(synthesizeSpeech("hi")).rejects.toBeInstanceOf(TtsError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns decoded audio on success", async () => {
    process.env.MINIMAX_API_KEY = "k";
    const hex = "ff".repeat(4096);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ base_resp: { status_code: 0 }, data: { audio: hex } }),
        { status: 200 },
      ),
    );
    const buf = await synthesizeSpeech("你好");
    expect(buf.length).toBe(4096);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.language_boost).toBe("Chinese");
    expect(body.voice_setting.voice_id).toBe("female-shaonv");
  });

  it("rejects placeholder-sized audio — the 2026-06-14 account bug shape", async () => {
    process.env.MINIMAX_API_KEY = "k";
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ base_resp: { status_code: 0 }, data: { audio: "abcd" } }),
        { status: 200 },
      ),
    );
    await expect(synthesizeSpeech("hi")).rejects.toBeInstanceOf(TtsError);
  });

  it("carries the upstream status on a non-2xx response", async () => {
    process.env.MINIMAX_API_KEY = "k";
    fetchMock.mockResolvedValue(new Response("nope", { status: 429 }));
    await expect(synthesizeSpeech("hi")).rejects.toMatchObject({ status: 429 });
  });
});
