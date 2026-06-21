import "server-only";
import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "./supabase-server";

// Driver push tokens + delivery dispatch records. Service-role only — these
// tables have no RLS and sit behind the Bearer-guarded /api/driver/* routes.

// ── Driver identity ──────────────────────────────────────────────────────────
// A driver logs in with a short code; the code resolves to a `drivers` row via
// sha256(code) = code_hash. Replaces the single shared STAFF_DELIVERY_TOKEN.

export type DriverIdentity = {
  id: string;
  name: string;
  suburb: string | null;
  phone: string | null;
  vehicle: string | null;
  joinedAt: string | null;
  rating: number | null;
  prefs: Record<string, unknown>;
};

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/**
 * Resolve a login code to its driver. Returns null when the code matches no
 * active driver (so the caller can fall back to the legacy shared token during
 * the cutover).
 */
export async function getDriverByCode(
  code: string,
): Promise<DriverIdentity | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("drivers")
    .select("id, name, suburb, phone, vehicle, joined_at, rating, prefs")
    .eq("code_hash", hashCode(code))
    .eq("active", true)
    .maybeSingle();
  if (error) throw new Error(`getDriverByCode: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id as string,
    name: data.name as string,
    suburb: (data.suburb as string | null) ?? null,
    phone: (data.phone as string | null) ?? null,
    vehicle: (data.vehicle as string | null) ?? null,
    joinedAt: (data.joined_at as string | null) ?? null,
    rating: (data.rating as number | null) ?? null,
    prefs: (data.prefs as Record<string, unknown> | null) ?? {},
  };
}

/**
 * Upsert a driver device's Expo push token. Keyed on token, so a phone
 * re-registering (app reinstall, new build) just bumps last_seen_at.
 */
export async function upsertDriverPushToken(args: {
  token: string;
  platform: "ios" | "android";
  label?: string | null;
  appVersion?: string | null;
  driverId?: string | null;
}): Promise<void> {
  const admin = getSupabaseAdmin();
  const row: Record<string, unknown> = {
    token: args.token,
    platform: args.platform,
    label: args.label ?? null,
    app_version: args.appVersion ?? null,
    last_seen_at: new Date().toISOString(),
  };
  if (args.driverId) row.driver_id = args.driverId;
  const { error } = await admin
    .from("driver_push_tokens")
    .upsert(row, { onConflict: "token" });
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

export type DispatchStatus =
  | "pending"
  | "accepted"
  | "picked_up"
  | "delivered";

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
  driverId?: string | null;
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
  // Stamp the owning driver. Only when known — a later picked_up/delivered
  // upsert must not null out a driver_id set at accept time.
  if (args.driverId) row.driver_id = args.driverId;
  if (args.status === "accepted") row.accepted_at = now;
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
/**
 * Which of these orders a driver has already accepted. Acceptance is the
 * dispatch row reaching status 'accepted' (or beyond — picked_up/delivered),
 * which is the real "a driver took this job" signal for BOTH paid orders (where
 * accept also captures the card) and $0 loyalty-redeemed orders (no payment to
 * capture, but a driver must still agree to deliver). Orders with no dispatch
 * row, or still 'pending', are not yet accepted.
 */
export async function getAcceptedOrderIds(
  orderIds: string[],
): Promise<Set<string>> {
  if (orderIds.length === 0) return new Set();
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("delivery_dispatch")
    .select("order_id, status")
    .in("order_id", orderIds)
    .in("status", ["accepted", "picked_up", "delivered"]);
  if (error) throw new Error(`getAcceptedOrderIds: ${error.message}`);
  return new Set((data ?? []).map((r) => r.order_id as string));
}

export type DispatchRow = {
  status: DispatchStatus;
  driverId: string | null;
  driverLabel: string | null;
  fix: DriverFix | null;
};

/**
 * Batch-read the full dispatch row (status + owning driver + latest GPS fix)
 * for a set of orders — feeds the manager Live-Operations roster, which needs
 * to group active deliveries by driver and classify each as at-store / en-route
 * / GPS-paused. Orders with no dispatch row are simply absent from the result.
 */
export async function getDispatchRowsForOrders(
  orderIds: string[],
): Promise<Record<string, DispatchRow>> {
  if (orderIds.length === 0) return {};
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("delivery_dispatch")
    .select(
      "order_id, status, driver_id, driver_label, driver_lat, driver_lng, driver_heading, location_updated_at",
    )
    .in("order_id", orderIds);
  if (error) throw new Error(`getDispatchRowsForOrders: ${error.message}`);
  const rows: Record<string, DispatchRow> = {};
  for (const row of data ?? []) {
    const hasFix = row.driver_lat != null && row.driver_lng != null;
    rows[row.order_id as string] = {
      status: row.status as DispatchStatus,
      driverId: (row.driver_id as string | null) ?? null,
      driverLabel: (row.driver_label as string | null) ?? null,
      fix: hasFix
        ? {
            lat: row.driver_lat as number,
            lng: row.driver_lng as number,
            heading: row.driver_heading as number | null,
            updatedAt: row.location_updated_at as string | null,
          }
        : null,
    };
  }
  return rows;
}

/**
 * Batch-read driver profiles by id — resolves a roster's driver_id set to
 * names/suburbs/initials. Inactive drivers are still returned (a driver may go
 * inactive mid-shift; we still want to label their in-flight order).
 */
export async function getDriversByIds(
  ids: string[],
): Promise<Record<string, DriverIdentity>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return {};
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("drivers")
    .select("id, name, suburb, phone, vehicle, joined_at, rating, prefs")
    .in("id", unique);
  if (error) throw new Error(`getDriversByIds: ${error.message}`);
  const out: Record<string, DriverIdentity> = {};
  for (const d of data ?? []) {
    out[d.id as string] = {
      id: d.id as string,
      name: d.name as string,
      suburb: (d.suburb as string | null) ?? null,
      phone: (d.phone as string | null) ?? null,
      vehicle: (d.vehicle as string | null) ?? null,
      joinedAt: (d.joined_at as string | null) ?? null,
      rating: (d.rating as number | null) ?? null,
      prefs: (d.prefs as Record<string, unknown> | null) ?? {},
    };
  }
  return out;
}

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
 * Batch-read which of the given orders have been delivered — returns the set of
 * order ids whose dispatch row has a delivered_at timestamp. Orders with no
 * dispatch row (driver never picked them up in the app) are simply absent, i.e.
 * treated as not-yet-delivered. Used to classify delivery orders as done.
 */
export async function getDeliveredOrderIds(
  orderIds: string[],
): Promise<Set<string>> {
  if (orderIds.length === 0) return new Set();
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("delivery_dispatch")
    .select("order_id, delivered_at")
    .in("order_id", orderIds)
    .not("delivered_at", "is", null);
  if (error) throw new Error(`getDeliveredOrderIds: ${error.message}`);
  return new Set((data ?? []).map((row) => row.order_id as string));
}

/**
 * Read the cached driver→destination route for an order (see delivery-route.ts
 * for the refetch policy). Returns null when no dispatch row exists.
 */
export async function getRouteCache(
  orderId: string,
): Promise<import("./delivery-route").RouteCache | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("delivery_dispatch")
    .select(
      "route_polyline, route_origin_lat, route_origin_lng, route_duration_secs, route_fetched_at",
    )
    .eq("order_id", orderId)
    .maybeSingle();
  if (error) throw new Error(`getRouteCache: ${error.message}`);
  if (!data) return null;
  return {
    polyline: data.route_polyline as string | null,
    originLat: data.route_origin_lat as number | null,
    originLng: data.route_origin_lng as number | null,
    durationSecs: data.route_duration_secs as number | null,
    fetchedAt: data.route_fetched_at as string | null,
  };
}

export async function saveRouteCache(args: {
  orderId: string;
  polyline: string;
  originLat: number;
  originLng: number;
  durationSecs: number | null;
}): Promise<void> {
  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from("delivery_dispatch")
    .update({
      route_polyline: args.polyline,
      route_origin_lat: args.originLat,
      route_origin_lng: args.originLng,
      route_duration_secs: args.durationSecs,
      route_fetched_at: new Date().toISOString(),
    })
    .eq("order_id", args.orderId);
  if (error) throw new Error(`saveRouteCache: ${error.message}`);
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
