import "server-only";
import { getSupabaseAdmin } from "./supabase-server";

export type DevicePushToken = {
  id: string;
  user_id: string;
  token: string;
  platform: "ios" | "android";
  app_version: string | null;
};

/**
 * Upsert a device push token for a user. Same physical device can swap
 * users (account signout + signin) — we key on `token` (unique) and
 * repoint `user_id` if the token was already registered to a different
 * account. Also bumps `last_seen_at` so the table can be pruned later.
 */
export async function upsertDevicePushToken(args: {
  userId: string;
  token: string;
  platform: "ios" | "android";
  appVersion?: string | null;
}): Promise<void> {
  const admin = getSupabaseAdmin();
  const { error } = await admin.from("device_push_tokens").upsert(
    {
      user_id: args.userId,
      token: args.token,
      platform: args.platform,
      app_version: args.appVersion ?? null,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "token" },
  );
  if (error) throw new Error(`upsertDevicePushToken: ${error.message}`);
}

/**
 * Delete a push token. Called when the app signs out, or when Expo
 * returns `DeviceNotRegistered` on a send receipt.
 */
export async function deleteDevicePushToken(token: string): Promise<void> {
  const admin = getSupabaseAdmin();
  const { error } = await admin.from("device_push_tokens").delete().eq("token", token);
  if (error) throw new Error(`deleteDevicePushToken: ${error.message}`);
}

/**
 * All active push tokens for a user. Returns [] if the user has none.
 */
export async function getDevicePushTokensForUser(
  userId: string,
): Promise<DevicePushToken[]> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("device_push_tokens")
    .select("id,user_id,token,platform,app_version")
    .eq("user_id", userId);
  if (error) throw new Error(`getDevicePushTokensForUser: ${error.message}`);
  return (data ?? []) as DevicePushToken[];
}

/**
 * Atomically record that we sent a given notification kind for an
 * order. Returns true if this is the first record (caller should send
 * the push), false if Square already delivered this webhook and we
 * acted on it previously (caller should skip).
 *
 * Uses insert + unique-constraint violation as a silent skip.
 */
export async function claimOrderPushSlot(
  orderId: string,
  kind: "ready",
): Promise<boolean> {
  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from("order_push_notifications")
    .insert({ order_id: orderId, kind });
  if (error) {
    // Unique-key conflict surfaces as Postgres code 23505 — treat as
    // "already claimed, someone else will send the push".
    if (error.code === "23505") return false;
    throw new Error(`claimOrderPushSlot: ${error.message}`);
  }
  return true;
}
