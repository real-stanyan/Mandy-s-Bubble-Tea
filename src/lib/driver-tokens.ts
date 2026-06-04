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

/**
 * Stash the driver's latest GPS fix on the dispatch row. Called frequently
 * (every ~10s while a delivery is in progress) from the Bearer-guarded
 * POST /api/driver/location route. We only keep the latest point — no
 * breadcrumb history — so this is a plain update keyed on order_id. The row
 * already exists because tracking only starts after picked_up created it.
 */
export async function updateDriverLocation(args: {
  orderId: string;
  lat: number;
  lng: number;
  heading?: number | null;
}): Promise<void> {
  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from("delivery_dispatch")
    .update({
      driver_lat: args.lat,
      driver_lng: args.lng,
      driver_heading: args.heading ?? null,
      location_updated_at: new Date().toISOString(),
    })
    .eq("order_id", args.orderId);
  if (error) throw new Error(`updateDriverLocation: ${error.message}`);
}

export type DispatchTracking = {
  status: DispatchStatus;
  driverLat: number | null;
  driverLng: number | null;
  driverHeading: number | null;
  locationUpdatedAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
};

export type DriverFix = {
  lat: number;
  lng: number;
  heading: number | null;
  updatedAt: string | null;
};

/**
 * Batch-read the latest driver GPS fix for a set of orders — feeds the
 * admin (read-only manager) view of the driver app. Orders with no dispatch
 * row or no fix yet are simply absent from the result.
 */
export async function getDriverFixesForOrders(
  orderIds: string[],
): Promise<Record<string, DriverFix>> {
  if (orderIds.length === 0) return {};
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("delivery_dispatch")
    .select("order_id, driver_lat, driver_lng, driver_heading, location_updated_at")
    .in("order_id", orderIds);
  if (error) throw new Error(`getDriverFixesForOrders: ${error.message}`);
  const fixes: Record<string, DriverFix> = {};
  for (const row of data ?? []) {
    if (row.driver_lat == null || row.driver_lng == null) continue;
    fixes[row.order_id as string] = {
      lat: row.driver_lat as number,
      lng: row.driver_lng as number,
      heading: row.driver_heading as number | null,
      updatedAt: row.location_updated_at as string | null,
    };
  }
  return fixes;
}

/**
 * Read the dispatch row's tracking fields for the customer-facing live map.
 * Returns null if no dispatch row exists yet (driver hasn't picked up).
 */
export async function getDispatchTracking(
  orderId: string,
): Promise<DispatchTracking | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("delivery_dispatch")
    .select(
      "status, driver_lat, driver_lng, driver_heading, location_updated_at, picked_up_at, delivered_at",
    )
    .eq("order_id", orderId)
    .maybeSingle();
  if (error) throw new Error(`getDispatchTracking: ${error.message}`);
  if (!data) return null;
  return {
    status: data.status as DispatchStatus,
    driverLat: data.driver_lat as number | null,
    driverLng: data.driver_lng as number | null,
    driverHeading: data.driver_heading as number | null,
    locationUpdatedAt: data.location_updated_at as string | null,
    pickedUpAt: data.picked_up_at as string | null,
    deliveredAt: data.delivered_at as string | null,
  };
}
