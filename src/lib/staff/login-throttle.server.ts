import "server-only";
import { headers } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { isMissingTableError } from "@/lib/postgrest-errors";
import {
  lockRemainingMinutes,
  nextStateAfterFailure,
  type AttemptRow,
} from "@/lib/staff/login-throttle";

// I/O half of the login throttle. The counter lives in Supabase because each
// request may hit a different serverless instance (see migration 007).

const TABLE = "staff_login_attempts";

/**
 * Best identifier we have for "who is knocking".
 *
 * Vercel always sets x-forwarded-for; the first entry is the client as seen by
 * the edge. Requests without one all share the `unknown` bucket, which is
 * deliberately strict: something is knocking without an address, and one
 * shared budget for all of them is the safe reading.
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || h.get("x-real-ip")?.trim() || "unknown";
}

async function readRow(ip: string): Promise<AttemptRow | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from(TABLE)
    .select("failures,window_started_at,locked_until")
    .eq("ip", ip)
    .maybeSingle();
  if (error) {
    // A missing table means migration 007 has not been applied yet. Fail open
    // rather than locking the whole shop out of the stock check: no throttle
    // is the behaviour we already had, whereas a login nobody can pass is an
    // outage. The gap is loud in the logs and closes when the migration runs.
    if (isMissingTableError(error)) {
      console.error(`[staff-login] ${TABLE} missing — throttle disabled until migration 007 runs`);
      return null;
    }
    throw new Error(`${TABLE} read: ${error.message}`);
  }
  if (!data) return null;
  const row = data as {
    failures: number;
    window_started_at: string;
    locked_until: string | null;
  };
  return {
    failures: row.failures,
    windowStartedAt: row.window_started_at,
    lockedUntil: row.locked_until,
  };
}

/** Minutes this IP must wait, or 0 when it may try. */
export async function lockoutMinutes(ip: string): Promise<number> {
  return lockRemainingMinutes(await readRow(ip), Date.now());
}

/** Count a wrong passcode. Returns the minutes the IP is now locked out, if any. */
export async function recordFailure(ip: string): Promise<number> {
  const now = Date.now();
  const next = nextStateAfterFailure(await readRow(ip), now);
  const admin = getSupabaseAdmin();
  const { error } = await admin.from(TABLE).upsert(
    {
      ip,
      failures: next.failures,
      window_started_at: next.windowStartedAt,
      locked_until: next.lockedUntil,
    },
    { onConflict: "ip" },
  );
  // A throttle that cannot write must not block the login — same reasoning as
  // readRow. Losing a count is worse than an outage only if the passcode is
  // weak, which is a separate fix.
  if (error && !isMissingTableError(error)) {
    console.error(`[staff-login] ${TABLE} write: ${error.message}`);
  }
  return lockRemainingMinutes(next, now);
}

/** A correct passcode wipes the IP's history. */
export async function clearFailures(ip: string): Promise<void> {
  const admin = getSupabaseAdmin();
  const { error } = await admin.from(TABLE).delete().eq("ip", ip);
  if (error && !isMissingTableError(error)) {
    console.error(`[staff-login] ${TABLE} clear: ${error.message}`);
  }
}
