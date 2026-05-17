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
