import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase-server";

/** Requests per IP per clock hour. Generous for a human ordering a drink,
 *  tight enough that a script hits the wall before the DeepSeek bill does. */
export const CHAT_HOURLY_LIMIT = 30;

export type RateLimitVerdict = { allowed: boolean; remaining: number };

/** Salted SHA-256 of the caller's IP. The salt keeps the table from being a
 *  rainbow-table-able list of who visited; the raw IP is never stored.
 *  Missing or empty salt would make the hash publicly computable
 *  (`sha256(":" + ip)`), which turns the rate limiter into a targeted-lockout
 *  tool against any IP an attacker can guess — so this throws rather than
 *  silently degrading. */
export function hashIp(ip: string): string {
  const salt = process.env.CHAT_RATE_LIMIT_SALT;
  if (!salt) {
    throw new Error("CHAT_RATE_LIMIT_SALT is not set");
  }
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

/** Truncate to the top of the hour, ISO-8601. */
function hourBucket(now: Date): string {
  const d = new Date(now);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

/**
 * Count this request and say whether it may proceed.
 *
 * The increment and the read happen in one SQL statement
 * (bump_chat_rate_limit) — a read-then-write pair would let two concurrent
 * requests both observe a count under the limit and both pass.
 *
 * Fails OPEN. If Supabase is unreachable, the chatbox keeps working without
 * a limiter rather than going dark; an unmetered window is a smaller problem
 * than a dead feature, and the DeepSeek account has its own hard ceiling.
 */
export async function checkChatRateLimit(
  ipHash: string,
  now: Date = new Date(),
): Promise<RateLimitVerdict> {
  try {
    const { data, error } = await getSupabaseAdmin().rpc("bump_chat_rate_limit", {
      p_ip_hash: ipHash,
      p_hour_bucket: hourBucket(now),
    });
    if (error || typeof data !== "number") {
      // If the RPC breaks, this is the only signal between a public
      // endpoint and a metered LLM disappearing — silently failing open
      // means nobody finds out until the DeepSeek bill does. Log the
      // error's own message only: `error` here is a PostgrestError-shaped
      // object that can carry connection detail, so the object itself
      // never gets logged, just its `.message`.
      console.error(
        "[chat] rate limit RPC returned an error or a non-numeric count; failing open (this request is unmetered):",
        error?.message ?? `unexpected data type: ${typeof data}`,
      );
      return { allowed: true, remaining: CHAT_HOURLY_LIMIT };
    }
    return {
      allowed: data <= CHAT_HOURLY_LIMIT,
      remaining: Math.max(0, CHAT_HOURLY_LIMIT - data),
    };
  } catch (err) {
    console.error(
      "[chat] rate limit RPC threw; failing open (this request is unmetered):",
      err instanceof Error ? err.message : String(err),
    );
    return { allowed: true, remaining: CHAT_HOURLY_LIMIT };
  }
}
