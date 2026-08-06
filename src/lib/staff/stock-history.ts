// Last submitted count, kept so the next count can show what was on the shelf
// before.
//
// Why it matters: "3" means nothing on its own, but "3, was 12 yesterday"
// means someone either had a big day or miscounted, and it is the only signal
// that catches a fat-fingered entry before it reaches the order. Staff used to
// get this by remembering.
//
// It lives on the device, not the server. The shop counts on one till, and a
// table for this would need a migration that cannot be applied from here (see
// the stock-check history issue). Per-device is not the right long-term home —
// counting from a phone would show nothing — but it is honest about what it
// has: every reading is stamped with the date it was taken, so a stale or
// absent snapshot is visible rather than silently misleading.

const KEY = "mandys-stock-last";

export type StockSnapshot = {
  /** ISO date (Brisbane calendar day) the count was submitted. */
  date: string;
  /** item id -> the normalised count string. Blank entries are not stored. */
  counts: Record<string, string>;
};

export function readSnapshot(): StockSnapshot | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as StockSnapshot).date !== "string" ||
      typeof (parsed as StockSnapshot).counts !== "object"
    ) {
      // Written by an older build, or hand-edited. A wrong "was N" is worse
      // than no "was N", so discard rather than guess.
      return null;
    }
    return parsed as StockSnapshot;
  } catch {
    return null;
  }
}

export function writeSnapshot(counts: Record<string, string>, now: Date): void {
  // Blanks are dropped: an item nobody counted has no previous reading to
  // offer, and storing "" would overwrite a usable older one with nothing.
  const kept: Record<string, string> = {};
  for (const [id, value] of Object.entries(counts)) {
    if (value.trim() !== "") kept[id] = value.trim();
  }
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ date: brisbaneDate(now), counts: kept } satisfies StockSnapshot),
    );
  } catch {
    // Storage full / private mode. The previous-count hint is a convenience;
    // losing it must never block submitting a count.
  }
}

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
