// Store open/close status for Australia/Brisbane (UTC+10, no DST).
// Ported from the RN app (`components/home/helpers.ts`). Hours are
// 10:30–22:30 every day with a 5-minute pre-close order cutoff (22:25).

export type StoreStatus = { open: boolean; nextLabel: string };

const OPEN_MIN = 10 * 60 + 30;
const CLOSE_MIN = 22 * 60 + 30;

function brisbaneDate(date: Date): Date {
  return new Date(date.getTime() + 10 * 60 * 60 * 1000);
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
  const brisbane = brisbaneDate(now);
  const minutes =
    brisbane.getUTCHours() * 60 + brisbane.getUTCMinutes();
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
