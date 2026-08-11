import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { bearerTokenMatches } from "@/lib/bearer-auth";
import { CHAT_LOG_RETENTION_DAYS } from "@/lib/chat/log";

export const dynamic = "force-dynamic";

/**
 * Deletes chat transcripts past the retention window.
 *
 * Customer conversations carry names, addresses and complaints. Keeping
 * them forever turns a support tool into a liability, so the window is
 * enforced by a job rather than by anyone remembering. Same fail-closed
 * bearer check as the other crons: an unset CRON_SECRET means nobody can
 * trigger a bulk delete from the public internet.
 */
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[cron/chat-log-retention] CRON_SECRET not configured");
    return NextResponse.json({ ok: false, error: "not configured" }, { status: 503 });
  }
  if (!bearerTokenMatches(request, expected)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(
    Date.now() - CHAT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { error, count } = await getSupabaseAdmin()
    .from("chat_logs")
    .delete({ count: "exact" })
    .lt("created_at", cutoff);

  if (error) {
    // Includes "table does not exist" until the migration is applied —
    // reported, not thrown, so the cron doesn't page anyone over a feature
    // that simply isn't deployed yet.
    console.warn("[cron/chat-log-retention] delete failed:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 200 });
  }

  return NextResponse.json({ ok: true, deleted: count ?? 0, cutoff });
}
