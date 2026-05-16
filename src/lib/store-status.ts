// Store open/close status for Australia/Brisbane (UTC+10, no DST).
// Ported from the RN app (`components/home/helpers.ts`). Hours are
// 10:30–22:30 every day with a 15-minute pre-close order cutoff (22:15).

import { getSupabaseAdmin } from "@/lib/supabase-server";

export type StoreStatus = { open: boolean; nextLabel: string };
export type OrderingStatus = { open: boolean; nextLabel: string };

const OPEN_MIN = 10 * 60 + 30;
const CLOSE_MIN = 22 * 60 + 30;
const ORDER_CUTOFF_MIN = 22 * 60 + 15;

function brisbaneDate(date: Date): Date {
  return new Date(date.getTime() + 10 * 60 * 60 * 1000);
}

function brisbaneMinutes(now: Date): number {
  const brisbane = brisbaneDate(now);
  return brisbane.getUTCHours() * 60 + brisbane.getUTCMinutes();
}

function formatClock(minsOfDay: number): string {
  const h24 = Math.floor(minsOfDay / 60);
  const m = minsOfDay % 60;
  const suffix = h24 < 12 || h24 === 24 ? "am" : "pm";
  const mod = h24 % 12;
  const hLabel = mod === 0 ? 12 : mod;
  return m === 0
    ? `${hLabel}${suffix}`
    : `${hLabel}:${String(m).padStart(2, "0")}${suffix}`;
}

export function getStoreStatus(now: Date = new Date()): StoreStatus {
  const minutes = brisbaneMinutes(now);
  const isOpen = minutes >= OPEN_MIN && minutes < CLOSE_MIN;
  if (isOpen) {
    return { open: true, nextLabel: `until ${formatClock(CLOSE_MIN)}` };
  }
  const beforeOpen = minutes < OPEN_MIN;
  return {
    open: false,
    nextLabel: beforeOpen
      ? `${formatClock(OPEN_MIN)}`
      : `${formatClock(OPEN_MIN)} tomorrow`,
  };
}

// Online ordering window: 10:30am – 22:15pm (15 min before physical close
// so staff have time to finish the last cup). Used by the cart drawer,
// checkout page, and /api/orders to gate new orders. Server is
// authoritative — clients re-check every 60s for display only.
export function getOrderingStatus(now: Date = new Date()): OrderingStatus {
  const minutes = brisbaneMinutes(now);
  const isOpen = minutes >= OPEN_MIN && minutes < ORDER_CUTOFF_MIN;
  if (isOpen) {
    return { open: true, nextLabel: `until ${formatClock(ORDER_CUTOFF_MIN)}` };
  }
  const beforeOpen = minutes < OPEN_MIN;
  return {
    open: false,
    nextLabel: beforeOpen
      ? `Opens ${formatClock(OPEN_MIN)}`
      : `Opens ${formatClock(OPEN_MIN)} tomorrow`,
  };
}

const POS_BACKUP_CACHE_TTL_MS = 60_000;
let posBackupCache: { value: boolean; fetchedAt: number } | null = null;

export function __resetPosBackupCacheForTests(): void {
  posBackupCache = null;
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
    // Defensive: never let a Supabase outage close the store unexpectedly.
    // Fall back to the conservative "with cutoff" default (false).
    posBackupCache = { value: false, fetchedAt: now };
    return false;
  }
}

export async function getEffectiveOrderingStatus(
  now: Date = new Date(),
): Promise<OrderingStatus> {
  const backup = await readPosBackupMode();
  if (!backup) return getOrderingStatus(now);

  // Backup mode: cutoff = physical close (22:30) instead of 22:15.
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
