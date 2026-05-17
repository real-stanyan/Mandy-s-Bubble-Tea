// Store open/close status for Australia/Brisbane (UTC+10, no DST).
// Ported from the RN app (`components/home/helpers.ts`). Hours are
// 10:30–22:30 every day with a 15-minute pre-close order cutoff (22:15).

export type StoreStatus = { open: boolean; nextLabel: string };
export type OrderingStatus = { open: boolean; nextLabel: string };

export const OPEN_MIN = 10 * 60 + 30;
export const CLOSE_MIN = 22 * 60 + 30;
export const ORDER_CUTOFF_MIN = 22 * 60 + 15;

export function brisbaneDate(date: Date): Date {
  return new Date(date.getTime() + 10 * 60 * 60 * 1000);
}

export function brisbaneMinutes(now: Date): number {
  const brisbane = brisbaneDate(now);
  return brisbane.getUTCHours() * 60 + brisbane.getUTCMinutes();
}

export function formatClock(minsOfDay: number): string {
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
