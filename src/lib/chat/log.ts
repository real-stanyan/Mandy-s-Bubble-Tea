import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-server";

/** How long transcripts are kept. Customer conversations carry names,
 *  addresses and complaints; an unbounded archive of them is a liability,
 *  not a feature. The retention cron deletes past this. */
export const CHAT_LOG_RETENTION_DAYS = 90;

const MAX_CONTENT = 2000;
const MAX_ID = 80;

export type ChatLogEntry = {
  conversationId: string;
  turnIndex: number;
  role: "user" | "assistant";
  content: string;
  surface: string | null;
  ipHash: string | null;
  proposalCount?: number;
  action?: string | null;
};

/** A conversation id for a client that didn't send one — an App build from
 *  before this shipped. Buckets by IP hash and hour so that client's turns
 *  still group into something readable instead of one row per message with
 *  nothing tying them together. Deliberately coarse: it is a fallback, not
 *  an identity. */
export function fallbackConversationId(ipHash: string | null, now: Date): string {
  const hour = now.toISOString().slice(0, 13); // YYYY-MM-DDTHH
  return `anon-${ipHash ?? "unknown"}-${hour}`;
}

/** Accept only a client id that looks like one we mint — anything else is
 *  someone else's data mixed into a thread. */
export function normalizeConversationId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v || v.length > MAX_ID) return null;
  return /^[A-Za-z0-9_-]+$/.test(v) ? v : null;
}

/**
 * Record one exchange. Fire-and-forget by contract: logging must never
 * slow a reply down, and must never be the reason a customer's chat
 * fails. Every failure — including the table not existing yet — is
 * swallowed after a single log line.
 */
export async function recordChatTurns(entries: ChatLogEntry[]): Promise<void> {
  if (entries.length === 0) return;
  try {
    const rows = entries.map((e) => ({
      conversation_id: e.conversationId,
      turn_index: e.turnIndex,
      role: e.role,
      content: e.content.slice(0, MAX_CONTENT),
      surface: e.surface,
      ip_hash: e.ipHash,
      proposal_count: e.proposalCount ?? 0,
      action: e.action ?? null,
    }));
    const { error } = await getSupabaseAdmin().from("chat_logs").insert(rows);
    if (error) throw error;
  } catch (err) {
    // Not console.error: until the migration is applied this fires on every
    // single chat, and a predictable "not deployed yet" state should not
    // drown the log that real incidents live in.
    console.warn(
      "[chat] transcript not recorded:",
      err instanceof Error ? err.message : String(err),
    );
  }
}
