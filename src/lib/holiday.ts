// Brisbane = UTC+10 year-round (QLD has no DST since 1992).
// Single source of truth for PH detection used by server, UI, and banner.

import { PUBLIC_HOLIDAYS_2026, type PublicHolidayDef } from "./constants";

const ALL_HOLIDAYS: PublicHolidayDef[] = [...PUBLIC_HOLIDAYS_2026];

function brisbaneParts(now: Date): { ymd: string; hour: number } {
  const ms = now.getTime() + 10 * 60 * 60 * 1000;
  const d = new Date(ms);
  return { ymd: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
}

export function getActivePublicHoliday(
  now: Date = new Date(),
): PublicHolidayDef | null {
  const { ymd, hour } = brisbaneParts(now);
  const match = ALL_HOLIDAYS.find((h) => h.date === ymd);
  if (!match) return null;
  if (match.startHour != null && hour < match.startHour) return null;
  return match;
}

export function isPublicHolidayActive(now: Date = new Date()): boolean {
  return getActivePublicHoliday(now) !== null;
}
