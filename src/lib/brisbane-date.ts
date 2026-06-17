// Brisbane (Australia/Brisbane, no DST) calendar-day helpers. The shop runs on
// Brisbane local time, so "today" for order classification must be evaluated in
// that zone regardless of where the server/browser runs.

function brisbaneYmd(d: Date): string {
  // en-CA formats as YYYY-MM-DD, which compares lexicographically as a day key.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Brisbane",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
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
