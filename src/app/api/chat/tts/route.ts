import { getSupabaseAdmin } from "@/lib/supabase-server";
import {
  synthesizeSpeech,
  ttsCacheKey,
  TtsError,
} from "@/lib/chat/tts";
import {
  checkChatRateLimit,
  hashIp,
  CHAT_HOURLY_LIMIT,
} from "@/lib/chat/rate-limit";

export const dynamic = "force-dynamic";

/** Replies are one or two sentences by the system prompt's own rule; 600
 *  chars is far above any legitimate reply and far below abuse territory. */
const MAX_TEXT = 600;

/** Public bucket of content-addressed mp3 clips. Same clip for the same
 *  reply text forever — synthesis runs once, every later customer gets the
 *  cached URL. */
const BUCKET = "tts-cache";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function clientIp(request: Request): string {
  const vercelFwd = request.headers.get("x-vercel-forwarded-for");
  if (vercelFwd) return vercelFwd.split(",")[0]?.trim() || "unknown";
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

let bucketReady = false;
/** Lazily ensure the bucket exists — createBucket on an existing bucket
 *  errors, which is fine; the flag just skips the round-trip after the
 *  first success in this lambda's lifetime. */
async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  const admin = getSupabaseAdmin();
  await admin.storage
    .createBucket(BUCKET, { public: true })
    .catch(() => undefined);
  bucketReady = true;
}

/**
 * POST { text } → { url } of an mp3 of Mandy saying it, or 503 when
 * synthesis is impossible — the client treats any failure as "no audio"
 * and keeps the text reply, never an error the customer sees.
 */
export async function POST(request: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const text =
    raw && typeof raw === "object" && typeof (raw as { text?: unknown }).text === "string"
      ? ((raw as { text: string }).text ?? "").trim()
      : "";
  if (!text || text.length > MAX_TEXT) return json({ error: "invalid text" }, 400);

  // Same limiter, same fail-open posture as /api/chat: a dead counter or
  // missing salt must not take the feature down.
  let allowed = true;
  try {
    allowed = (await checkChatRateLimit(hashIp(clientIp(request)))).allowed;
  } catch (err) {
    console.error(
      "[tts] rate limit unavailable; serving unmetered:",
      err instanceof Error ? err.message : String(err),
    );
    allowed = true;
    void CHAT_HOURLY_LIMIT;
  }
  if (!allowed) return json({ error: "rate limited" }, 429);

  const key = ttsCacheKey(text);
  const path = `${key}.mp3`;
  const admin = getSupabaseAdmin();

  await ensureBucket();

  // Cache hit: list is the cheapest existence check the storage API has.
  const { data: existing } = await admin.storage
    .from(BUCKET)
    .list("", { search: path, limit: 1 });
  if (existing?.some((f) => f.name === path)) {
    return json({ url: admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl });
  }

  let audio: Buffer;
  try {
    audio = await synthesizeSpeech(text);
  } catch (err) {
    // Status only, never the message body — TtsError can embed provider
    // payload the same way DeepSeekError can.
    console.error(
      "[tts] synthesis failed:",
      err instanceof TtsError && err.status !== undefined
        ? `TtsError (upstream ${err.status})`
        : err instanceof Error
          ? err.name
          : "unknown",
    );
    return json({ error: "tts unavailable" }, 503);
  }

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(path, audio, { contentType: "audio/mpeg", upsert: true });
  if (uploadError) {
    // The clip exists in memory but not in cache — still serve it this
    // once as a data URL rather than failing a synthesis that already
    // succeeded and was already paid for.
    console.error("[tts] cache upload failed:", uploadError.message);
    return json({ url: `data:audio/mpeg;base64,${audio.toString("base64")}` });
  }

  return json({ url: admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl });
}
