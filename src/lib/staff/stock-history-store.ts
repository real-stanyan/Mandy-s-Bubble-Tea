import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { brisbaneDate, type StockSnapshot } from "./stock-history";

// Where the last stock count is kept, so the next one can show what was on the
// shelf before.
//
// It lives in `app_settings`, a key/value table that already exists, rather
// than in a table of its own. A dedicated `stock_checks` table is the better
// shape — it would keep history rather than only the latest reading — but
// creating one needs DDL, and the credential for that is not available in
// every environment (see ADR-0008 on capability belonging to the environment).
// A row in an existing table needs no migration, so the feature works now
// instead of waiting for someone with a token.
//
// The tradeoff is deliberate and narrow: exactly one snapshot is kept. That is
// all the UI shows, and a real history is worth doing properly when the table
// exists.

const KEY = "stock_last_count";

/**
 * The previous count, or null when there is none — first ever count, or the
 * settings row is unreadable. Never throws: a missing hint must not stop staff
 * from counting.
 */
export async function readLastCount(): Promise<StockSnapshot | null> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("app_settings")
      .select("value")
      .eq("key", KEY)
      .maybeSingle();
    if (error || !data) return null;
    const value = data.value as unknown;
    if (
      typeof value !== "object" ||
      value === null ||
      typeof (value as StockSnapshot).date !== "string" ||
      typeof (value as StockSnapshot).counts !== "object"
    ) {
      return null;
    }
    return value as StockSnapshot;
  } catch {
    return null;
  }
}

/**
 * Record a submitted count as the new "previous".
 *
 * Blanks are dropped: an item nobody counted has no reading to offer, and
 * storing "" would replace a usable older number with nothing.
 *
 * Returns false rather than throwing — the report has already been emailed by
 * the time this runs, and losing the hint must never turn a delivered report
 * into an error the staff member sees.
 */
export async function writeLastCount(
  counts: Record<string, string>,
  now: Date,
): Promise<boolean> {
  const kept: Record<string, string> = {};
  for (const [id, value] of Object.entries(counts)) {
    const trimmed = value?.trim() ?? "";
    if (trimmed !== "") kept[id] = trimmed;
  }
  const snapshot: StockSnapshot = { date: brisbaneDate(now), counts: kept };
  try {
    const { error } = await getSupabaseAdmin()
      .from("app_settings")
      .upsert(
        { key: KEY, value: snapshot, updated_at: new Date().toISOString() },
        { onConflict: "key" },
      );
    if (error) {
      console.error("[stock-check] could not record previous count", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[stock-check] could not record previous count", e);
    return false;
  }
}
