// Brisbane (Australia/Brisbane, no DST) calendar-day helpers. The shop runs on
// Brisbane local time, so "today" for order classification must be evaluated in
// that zone regardless of where the server/browser runs.

export function brisbaneYmd(d: Date): string {
  // en-CA formats as YYYY-MM-DD, which compares lexicographically as a day key.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Brisbane",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** "9:18 AM" in Brisbane local time, for a history/shift row timestamp. */
export function brisbaneClock(iso: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Brisbane",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

/** "Monday" — the Brisbane weekday name, for grouping older history days. */
export function brisbaneWeekday(iso: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Brisbane",
    weekday: "long",
  }).format(new Date(iso));
}

/**
 * True when the given ISO timestamp falls on the current Brisbane calendar day.
 * `now` is injectable for testing; defaults to the current time.
 */
export function isBrisbaneToday(iso: string | null | undefined, now = new Date()): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return brisbaneYmd(d) === brisbaneYmd(now);
}
