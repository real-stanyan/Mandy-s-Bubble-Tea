import "server-only";
import { getSupabaseAdmin } from "./supabase-server";

// Driver push tokens + delivery dispatch records. Service-role only — these
// tables have no RLS and sit behind the Bearer-guarded /api/driver/* routes.

/**
 * Upsert a driver device's Expo push token. Keyed on token, so a phone
 * re-registering (app reinstall, new build) just bumps last_seen_at.
 */
export async function upsertDriverPushToken(args: {
  token: string;
  platform: "ios" | "android";
  label?: string | null;
  appVersion?: string | null;
}): Promise<void> {
  const admin = getSupabaseAdmin();
  const { error } = await admin.from("driver_push_tokens").upsert(
    {
      token: args.token,
      platform: args.platform,
      label: args.label ?? null,
      app_version: args.appVersion ?? null,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "token" },
  );
  if (error) throw new Error(`upsertDriverPushToken: ${error.message}`);
}

export async function deleteDriverPushToken(token: string): Promise<void> {
  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from("driver_push_tokens")
    .delete()
    .eq("token", token);
  if (error) throw new Error(`deleteDriverPushToken: ${error.message}`);
}

/** Every registered driver push token. Returns [] if none. */
export async function getAllDriverPushTokens(): Promise<string[]> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("driver_push_tokens")
    .select("token");
  if (error) throw new Error(`getAllDriverPushTokens: ${error.message}`);
  return (data ?? []).map((r) => r.token as string);
}

export type DispatchStatus = "pending" | "picked_up" | "delivered";

/**
 * Record a delivery lifecycle transition. Upsert keyed on order_id so the
 * first touch (picked_up) creates the row and later touches (delivered)
 * update it. Stamps the matching timestamp column.
 */
export async function recordDispatch(args: {
  orderId: string;
  orderNumber?: string | null;
  status: DispatchStatus;
  driverLabel?: string | null;
}): Promise<void> {
  const admin = getSupabaseAdmin();
  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    order_id: args.orderId,
    order_number: args.orderNumber ?? null,
    status: args.status,
    driver_label: args.driverLabel ?? null,
    updated_at: now,
  };
  if (args.status === "picked_up") row.picked_up_at = now;
  if (args.status === "delivered") row.delivered_at = now;

  const { error } = await admin
    .from("delivery_dispatch")
    .upsert(row, { onConflict: "order_id" });
  if (error) throw new Error(`recordDispatch: ${error.message}`);
}
