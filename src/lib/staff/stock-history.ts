// Shape and dating of the last submitted count, kept so the next count can
// show what was on the shelf before.
//
// Why it matters: "3" means nothing on its own, but "3, was 12 yesterday"
// means someone either had a big day or miscounted, and it is the only signal
// that catches a fat-fingered entry before it reaches the order. Staff used to
// get this by remembering.
//
// Reading and writing live in stock-history-store.ts (server, Supabase). This
// file is the parts both sides need: the type, and how a date is turned into
// something a person reads. It stays free of storage so it can be tested and
// used from a client component.

export type StockSnapshot = {
  /** ISO date (Brisbane calendar day) the count was submitted. */
  date: string;
  /** item id -> the normalised count string. Blank entries are not stored. */
  counts: Record<string, string>;
};

/** `2026-08-06` in the shop's timezone — the day staff would call "today". */
export function brisbaneDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Brisbane",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * How the snapshot's age reads next to a number: "yesterday", "Tue", or a
 * date once it is old enough that the weekday alone is ambiguous.
 */
export function describeAge(snapshotDate: string, now: Date): string {
  const today = brisbaneDate(now);
  if (snapshotDate === today) return "earlier today";
  const days = daysBetween(snapshotDate, today);
  if (days === 1) return "yesterday";
  if (days > 1 && days <= 6) {
    const d = new Date(`${snapshotDate}T00:00:00+10:00`);
    return new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Brisbane",
      weekday: "short",
    }).format(d);
  }
  return snapshotDate;
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00+10:00`);
  const b = Date.parse(`${to}T00:00:00+10:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return -1;
  return Math.round((b - a) / 86_400_000);
}
