import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import {
  OPEN_MIN,
  CLOSE_MIN,
  brisbaneMinutes,
  formatClock,
  getOrderingStatus,
  type OrderingStatus,
} from "./store-status";

const POS_BACKUP_CACHE_TTL_MS = 60_000;
let posBackupCache: { value: boolean; fetchedAt: number } | null = null;

export function __resetPosBackupCacheForTests(): void {
  posBackupCache = null;
}

// Delivery on/off is boss-controlled at runtime from the Admin app via the
// shared `app_settings` table (key `delivery_enabled`, value = boolean). This
// is the single source of truth for "can customers place delivery orders", and
// it gates BOTH web and the App because they share `/api/orders`.
//
// Fallback when the row is MISSING or the read FAILS: the build-time
// `NEXT_PUBLIC_DELIVERY_ENABLED` env flag. So today's behaviour is preserved
// until the boss flips the switch (no seed required), and a transient Supabase
// blip can't silently flip a live delivery business — it inherits the env
// master instead. Only an explicit stored `false` turns delivery off.
const DELIVERY_ENABLED_CACHE_TTL_MS = 60_000;
let deliveryEnabledCache: { value: boolean; fetchedAt: number } | null = null;

export function __resetDeliveryEnabledCacheForTests(): void {
  deliveryEnabledCache = null;
}

function deliveryEnabledEnvDefault(): boolean {
  return process.env.NEXT_PUBLIC_DELIVERY_ENABLED === "true";
}

/** A delivery pause that ends by itself.
 *
 *  The plain `delivery_enabled` switch has no memory: whoever turns it off
 *  has to remember to turn it back on, and a forgotten switch is a day of
 *  silently refused delivery orders. A pause carries its own expiry, so
 *  "off until 5pm" needs nobody awake at 5pm — no cron, no scheduled job,
 *  nothing to fail. Past `until`, this returns null and delivery is back.
 *
 *  `reason` drives the customer-facing copy; "maintenance" is the only one
 *  in use today (Stan, 2026-08-11). */
export type DeliveryPause = { until: string; reason: string };

const DELIVERY_PAUSE_CACHE_TTL_MS = 60_000;
let deliveryPauseCache: { value: DeliveryPause | null; fetchedAt: number } | null = null;

export function __resetDeliveryPauseCacheForTests(): void {
  deliveryPauseCache = null;
}

/** The pause if one is currently in force, else null. A stored pause whose
 *  `until` has passed is treated as absent — expiry is what makes this
 *  self-healing, so it is checked on read, not on write. */
export async function getDeliveryPause(
  now: Date = new Date(),
): Promise<DeliveryPause | null> {
  const ms = Date.now();
  let stored: DeliveryPause | null;
  if (deliveryPauseCache && ms - deliveryPauseCache.fetchedAt < DELIVERY_PAUSE_CACHE_TTL_MS) {
    stored = deliveryPauseCache.value;
  } else {
    try {
      const { data, error } = await getSupabaseAdmin()
        .from("app_settings")
        .select("value")
        .eq("key", "delivery_pause")
        .maybeSingle();
      if (error) throw error;
      const v = data?.value as Partial<DeliveryPause> | null | undefined;
      stored =
        v && typeof v.until === "string" && typeof v.reason === "string"
          ? { until: v.until, reason: v.reason }
          : null;
      deliveryPauseCache = { value: stored, fetchedAt: ms };
    } catch {
      // Same posture as the switch below: a Supabase blip must not invent a
      // pause and take a live delivery business offline.
      stored = null;
      deliveryPauseCache = { value: null, fetchedAt: ms };
    }
  }
  if (!stored) return null;
  const until = Date.parse(stored.until);
  if (!Number.isFinite(until) || until <= now.getTime()) return null;
  return stored;
}

export async function isDeliveryEnabled(): Promise<boolean> {
  // A live pause outranks the switch — and because it expires on its own,
  // delivery comes back without anyone flipping anything. Checked here, in
  // the one function /api/orders and the UI both go through, so a paused
  // shop cannot take a delivery order from any surface.
  if (await getDeliveryPause()) return false;

  const now = Date.now();
  if (
    deliveryEnabledCache &&
    now - deliveryEnabledCache.fetchedAt < DELIVERY_ENABLED_CACHE_TTL_MS
  ) {
    return deliveryEnabledCache.value;
  }
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("app_settings")
      .select("value")
      .eq("key", "delivery_enabled")
      .maybeSingle();
    if (error) throw error;
    // Row absent → inherit the env master; row present → trust its boolean.
    const value = data == null ? deliveryEnabledEnvDefault() : data.value === true;
    deliveryEnabledCache = { value, fetchedAt: now };
    return value;
  } catch {
    const value = deliveryEnabledEnvDefault();
    deliveryEnabledCache = { value, fetchedAt: now };
    return value;
  }
}

async function readPosBackupMode(): Promise<boolean> {
  const now = Date.now();
  if (posBackupCache && now - posBackupCache.fetchedAt < POS_BACKUP_CACHE_TTL_MS) {
    return posBackupCache.value;
  }
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("app_settings")
      .select("value")
      .eq("key", "pos_backup_mode")
      .maybeSingle();
    if (error) throw error;
    const value = data?.value === true;
    posBackupCache = { value, fetchedAt: now };
    return value;
  } catch {
    posBackupCache = { value: false, fetchedAt: now };
    return false;
  }
}

export async function getEffectiveOrderingStatus(
  now: Date = new Date(),
): Promise<OrderingStatus> {
  const backup = await readPosBackupMode();
  if (!backup) return getOrderingStatus(now);

  const minutes = brisbaneMinutes(now);
  const isOpen = minutes >= OPEN_MIN && minutes < CLOSE_MIN;
  if (isOpen) {
    return { open: true, nextLabel: `until ${formatClock(CLOSE_MIN)}` };
  }
  const beforeOpen = minutes < OPEN_MIN;
  return {
    open: false,
    nextLabel: beforeOpen
      ? `Opens ${formatClock(OPEN_MIN)}`
      : `Opens ${formatClock(OPEN_MIN)} tomorrow`,
  };
}
