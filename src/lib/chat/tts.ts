import "server-only";
import { createHash } from "node:crypto";

/** Mandy's voice — preset picked by Stan/Xin from four-language samples,
 *  2026-08-10 (see the voice-assistant spec in the App repo). One preset,
 *  every language: speech-2.8-turbo is multilingual and language_boost
 *  steers pronunciation per reply. */
export const TTS_VOICE_ID = "female-shaonv";
export const TTS_MODEL = "speech-2.8-turbo";

const TTS_HOST = "https://api.minimaxi.com";
const TIMEOUT_MS = 20_000;

export class TtsError extends Error {
  readonly status?: number;
  constructor(message: string, opts: { status?: number } = {}) {
    super(message);
    this.name = "TtsError";
    this.status = opts.status;
  }
}

/** Same day-to-day heuristic the chat route uses for its fixed strings,
 *  extended for TTS: kana → Japanese, hangul → Korean, Han without kana →
 *  Chinese, else English. The model replies in the customer's language,
 *  so the reply text itself is the most reliable language signal. */
export function languageBoostFor(text: string): string {
  if (/[぀-ゟ゠-ヿ]/.test(text)) return "Japanese";
  if (/[가-힣]/.test(text)) return "Korean";
  if (/[㐀-鿿]/.test(text)) return "Chinese";
  return "English";
}

/** Cache key: voice + model + exact text. Any change to the voice or the
 *  model naturally invalidates every cached clip. */
export function ttsCacheKey(text: string): string {
  return createHash("sha256")
    .update(`${TTS_VOICE_ID}\n${TTS_MODEL}\n${text}`)
    .digest("hex");
}

/** Decode MiniMax's hex-encoded mp3 payload. */
export function hexToBuffer(hex: string): Buffer {
  return Buffer.from(hex, "hex");
}

/**
 * One synthesis round-trip to MiniMax t2a_v2.
 *
 * Throws TtsError on any failure — the route degrades to "no audio" and
 * the customer still has the text reply, so a dead TTS provider can never
 * take the chat down with it.
 */
export async function synthesizeSpeech(text: string): Promise<Buffer> {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new TtsError("MINIMAX_API_KEY is not configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${TTS_HOST}/v1/t2a_v2`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        text,
        stream: false,
        language_boost: languageBoostFor(text),
        voice_setting: { voice_id: TTS_VOICE_ID, speed: 1.0 },
        audio_setting: { format: "mp3" },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    throw new TtsError(
      err instanceof Error && err.name === "AbortError"
        ? "TTS request timed out"
        : `TTS request failed: ${String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new TtsError(`MiniMax responded ${res.status}`, { status: res.status });
  }

  const body = (await res.json()) as {
    base_resp?: { status_code?: number; status_msg?: string };
    data?: { audio?: string };
  };
  const hex = body.data?.audio;
  // MiniMax can answer 200 with an error in base_resp, or with a
  // placeholder payload (the 2026-06-14 account-level bug shipped tiny
  // fake clips) — anything under ~2KB is not a real sentence.
  if (!hex || body.base_resp?.status_code !== 0 || hex.length < 4096) {
    throw new TtsError(
      `MiniMax returned no usable audio (${body.base_resp?.status_msg ?? "no status"})`,
    );
  }
  return hexToBuffer(hex);
}
