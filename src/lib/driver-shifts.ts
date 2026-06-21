import "server-only";
import { getSupabaseAdmin } from "./supabase-server";

// Driver shift ledger (clock on/off) + per-driver preferences. Service-role
// only — sits behind the Bearer-guarded /api/driver/shift route. One open shift
// per driver is enforced by a partial unique index (driver_shifts_one_open_idx).

export type LocationMode = "while" | "always";

export type OpenShift = {
  id: string;
  startedAt: string;
  locationMode: LocationMode;
};

/** The driver's currently-open shift (ended_at IS NULL), or null when off. */
export async function getOpenShift(driverId: string): Promise<OpenShift | null> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("driver_shifts")
    .select("id, started_at, location_mode")
    .eq("driver_id", driverId)
    .is("ended_at", null)
    .maybeSingle();
  if (error) throw new Error(`getOpenShift: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id as string,
    startedAt: data.started_at as string,
    locationMode: (data.location_mode as LocationMode) ?? "while",
  };
}

/** Clock on. Idempotent: returns the existing open shift if already on. */
export async function startShift(
  driverId: string,
  locationMode: LocationMode = "while",
): Promise<OpenShift> {
  const existing = await getOpenShift(driverId);
  if (existing) return existing;
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("driver_shifts")
    .insert({ driver_id: driverId, location_mode: locationMode })
    .select("id, started_at, location_mode")
    .single();
  if (error) throw new Error(`startShift: ${error.message}`);
  return {
    id: data.id as string,
    startedAt: data.started_at as string,
    locationMode: (data.location_mode as LocationMode) ?? "while",
  };
}

/** Clock off. No-op when already off. */
export async function endShift(driverId: string): Promise<void> {
  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from("driver_shifts")
    .update({ ended_at: new Date().toISOString() })
    .eq("driver_id", driverId)
    .is("ended_at", null);
  if (error) throw new Error(`endShift: ${error.message}`);
}

/**
 * Persist the driver's preferred location-sharing mode. Lives on the driver
 * row (drivers.prefs), NOT the open shift — so toggling survives off-shift and
 * seeds the next "Go online". Returns the merged prefs.
 */
export async function setLocationMode(
  driverId: string,
  mode: LocationMode,
): Promise<Record<string, unknown>> {
  return updateDriverPrefs(driverId, { locationMode: mode });
}

/** Merge keys into drivers.prefs (jsonb). Read-modify-write — small object. */
export async function updateDriverPrefs(
  driverId: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const admin = getSupabaseAdmin();
  const { data: row, error: readErr } = await admin
    .from("drivers")
    .select("prefs")
    .eq("id", driverId)
    .maybeSingle();
  if (readErr) throw new Error(`updateDriverPrefs read: ${readErr.message}`);
  const merged = { ...((row?.prefs as Record<string, unknown> | null) ?? {}), ...patch };
  const { error } = await admin
    .from("drivers")
    .update({ prefs: merged })
    .eq("id", driverId);
  if (error) throw new Error(`updateDriverPrefs write: ${error.message}`);
  return merged;
}

export type DeliveredDispatchRow = {
  orderId: string;
  orderNumber: string | null;
  acceptedAt: string | null;
  deliveredAt: string | null;
};

/**
 * All delivered dispatch rows for a driver, newest first. The History screen
 * joins these to Square for address/items/fee. Capped to a recent window so a
 * long-tenured driver doesn't fan out into hundreds of Square lookups.
 */
export async function getDeliveredDispatchForDriver(
  driverId: string,
  limit = 60,
): Promise<DeliveredDispatchRow[]> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("delivery_dispatch")
    .select("order_id, order_number, accepted_at, delivered_at")
    .eq("driver_id", driverId)
    .eq("status", "delivered")
    .not("delivered_at", "is", null)
    .order("delivered_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getDeliveredDispatchForDriver: ${error.message}`);
  return (data ?? []).map((r) => ({
    orderId: r.order_id as string,
    orderNumber: (r.order_number as string | null) ?? null,
    acceptedAt: (r.accepted_at as string | null) ?? null,
    deliveredAt: (r.delivered_at as string | null) ?? null,
  }));
}
