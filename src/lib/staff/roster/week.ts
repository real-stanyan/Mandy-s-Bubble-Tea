import { WEEKDAYS, type Weekday } from "./model";

// Week identity and labels.
//
// A roster week runs Monday to Sunday, matching the sheet everyone already
// uses (`27/07-2/08`). Weeks are keyed by the ISO date of their Monday, so the
// key sorts chronologically as a plain string and never depends on the
// viewer's locale or timezone the way a "week number" would.

export const SHOP_TIMEZONE = "Australia/Brisbane";

/** ISO `YYYY-MM-DD` of the Monday on or before `date`, in shop time. */
export function weekKeyFor(date: Date = new Date()): string {
  const shopDate = shopCalendarDate(date);
  const dow = shopWeekdayIndex(date); // 0 = Monday
  shopDate.setUTCDate(shopDate.getUTCDate() - dow);
  return shopDate.toISOString().slice(0, 10);
}

/**
 * The calendar date as seen in the shop, expressed as a UTC-midnight Date so
 * day arithmetic can't be dragged across a boundary by the viewer's offset.
 */
function shopCalendarDate(date: Date): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHOP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return new Date(`${parts}T00:00:00Z`);
}

/** 0 = Monday … 6 = Sunday, read in shop time. */
function shopWeekdayIndex(date: Date): number {
  const short = new Intl.DateTimeFormat("en-AU", {
    timeZone: SHOP_TIMEZONE,
    weekday: "short",
  }).format(date);
  const map: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return map[short] ?? 0;
}

export function shiftWeek(weekKey: string, deltaWeeks: number): string {
  const d = new Date(`${weekKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaWeeks * 7);
  return d.toISOString().slice(0, 10);
}

export function dateOf(weekKey: string, day: Weekday): Date {
  const d = new Date(`${weekKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + WEEKDAYS.indexOf(day));
  return d;
}

function dm(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
}

/** `27/07-02/08`, the same heading style as the existing sheet. */
export function weekLabel(weekKey: string): string {
  return `${dm(dateOf(weekKey, "mon"))}-${dm(dateOf(weekKey, "sun"))}`;
}

export function isCurrentWeek(weekKey: string): boolean {
  return weekKey === weekKeyFor();
}
