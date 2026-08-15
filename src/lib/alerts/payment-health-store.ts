import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import type { AlertState } from "./payment-health";

// Whether we have already shouted about the current payment outage.
//
// Same app_settings row pattern as the stock snapshot and the delivery pause:
// no DDL, so this shipped without waiting for a migration credential
// (ADR-0008).

const KEY = "payment_alert_state";

/** Unreadable state reads as "we have not alerted". That errs toward sending
 *  an email we did not need rather than staying silent through an outage,
 *  which is the failure this whole file exists to prevent. */
export async function readAlertState(): Promise<AlertState> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("app_settings")
      .select("value")
      .eq("key", KEY)
      .maybeSingle();
    if (error || !data) return { alertedAt: null };
    const v = data.value as { alertedAt?: unknown };
    return {
      alertedAt: typeof v?.alertedAt === "string" ? v.alertedAt : null,
    };
  } catch {
    return { alertedAt: null };
  }
}

export async function writeAlertState(state: AlertState): Promise<void> {
  try {
    const { error } = await getSupabaseAdmin()
      .from("app_settings")
      .upsert(
        { key: KEY, value: state, updated_at: new Date().toISOString() },
        { onConflict: "key" },
      );
    if (error) console.error("[payment-alert] could not save state", error.message);
  } catch (e) {
    console.error("[payment-alert] could not save state", e);
  }
}
