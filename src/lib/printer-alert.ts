// src/lib/printer-alert.ts
import "server-only";
import { getSupabaseAdmin } from "./supabase-server";
import { sendExpoPush } from "./push";

/**
 * Push an alert to every admin owner's registered device. Shared by
 * the HTTP endpoint (/api/admin/print-alert, which the Mac mini
 * calls) and any server code that detects a print-related failure
 * inline (e.g. /api/payment when an inline enqueue fails for a $0
 * loyalty redemption — the normal webhook path wouldn't help there).
 *
 * Returns the number of push tokens that Expo accepted. Errors are
 * logged but never thrown, so callers can fire-and-forget.
 */
export async function notifyOwnersPrinterAlert(
  deviceId: string,
  message: string,
): Promise<number> {
  try {
    const admin = getSupabaseAdmin();
    const { data: owners, error: ownerErr } = await admin
      .from("admin_users")
      .select("user_id")
      .eq("role", "owner");
    if (ownerErr) {
      console.error("[printer-alert] admin_users query failed:", ownerErr.message);
      return 0;
    }
    const ownerIds = (owners ?? []).map((r: { user_id: string }) => r.user_id);
    if (ownerIds.length === 0) return 0;

    const { data: tokens, error: tokensErr } = await admin
      .from("device_push_tokens")
      .select("token")
      .in("user_id", ownerIds);
    if (tokensErr) {
      console.error("[printer-alert] push tokens query failed:", tokensErr.message);
      return 0;
    }
    const pushTokens = (tokens ?? []).map((t: { token: string }) => t.token);
    if (pushTokens.length === 0) return 0;

    const trimmed = message.slice(0, 280);
    return await sendExpoPush(pushTokens, {
      title: "Printer alert",
      body: `${deviceId}: ${trimmed}`,
      data: { kind: "printer-alert", deviceId, message: trimmed },
    });
  } catch (err) {
    console.error("[printer-alert] failed:", err);
    return 0;
  }
}
