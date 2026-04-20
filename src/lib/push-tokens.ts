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
 * Look up the Supabase user_id that owns a given Square customer id.
 * Returns null if no profile links this Square customer yet.
 */
export async function getUserIdBySquareCustomer(
  squareCustomerId: string,
): Promise<string | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("user_profiles")
    .select("user_id")
    .eq("square_customer_id", squareCustomerId)
    .maybeSingle();
  if (error) throw new Error(`getUserIdBySquareCustomer: ${error.message}`);
  return (data?.user_id as string | undefined) ?? null;
}
