import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import type { ThresholdOverrides } from "./stocklist";

// Reorder thresholds that have been changed from the ones in stocklist.ts.
//
// stocklist.ts still holds the defaults and says, at the top, that there is
// deliberately no UI for editing them — because a wrong threshold under-orders
// silently for weeks. Stan asked for the UI anyway (2026-08-14), which is his
// call to make. What that comment buys instead is the shape of this record:
// every override carries who set it and when, so a number that turns out to be
// wrong can be traced to a decision rather than found by archaeology, and the
// default is always one click away because it never left the code.
//
// Same storage as the last-count snapshot: a row in `app_settings`, no DDL, so
// this ships without waiting for a migration credential (ADR-0008).

const KEY = "stock_thresholds";

/** Absent or unreadable settings mean "no overrides" — the shop falls back to
 *  the defaults in code, which is the safe direction: counting still works and
 *  the numbers are the ones that have always been there. */
export async function readThresholds(): Promise<ThresholdOverrides> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("app_settings")
      .select("value")
      .eq("key", KEY)
      .maybeSingle();
    if (error || !data) return {};
    const value = data.value as unknown;
    if (typeof value !== "object" || value === null) return {};
    const out: ThresholdOverrides = {};
    for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
      if (typeof entry !== "object" || entry === null) continue;
      const v = (entry as { value?: unknown }).value;
      // A non-finite or negative override would make every count look fine
      // (nothing is <= NaN) — the exact silent under-order the comment in
      // stocklist.ts warns about. Drop it rather than trust it.
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) continue;
      out[id] = {
        value: v,
        by: typeof (entry as { by?: unknown }).by === "string" ? (entry as { by: string }).by : null,
        at: typeof (entry as { at?: unknown }).at === "string" ? (entry as { at: string }).at : null,
      };
    }
    return out;
  } catch {
    return {};
  }
}

/** Replace the whole override map. Returns false rather than throwing so a
 *  storage failure surfaces as "not saved" in the UI instead of a stack
 *  trace. */
export async function writeThresholds(next: ThresholdOverrides): Promise<boolean> {
  try {
    const { error } = await getSupabaseAdmin()
      .from("app_settings")
      .upsert(
        { key: KEY, value: next, updated_at: new Date().toISOString() },
        { onConflict: "key" },
      );
    if (error) {
      console.error("[stock-thresholds] could not save", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[stock-thresholds] could not save", e);
    return false;
  }
}
