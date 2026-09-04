// Reading old stock-check emails back into counts.
//
// Until 2026-09-05 the site kept only the most recent count; the history
// lived in the daily report emails. This turns pasted report text — the
// plain-text version, or what a mail client hands over when the HTML one is
// copied — back into one ShopCount per day, so usage can be measured from
// the past instead of waiting weeks for new counts to accumulate.
//
// Names are matched against the stock list by display name. Two names are
// used twice ("Orange" and "Lemon" are both a syrup and a fruit); within one
// section the report lists items in list order, so the first occurrence is
// the syrup, and a name that appears only once in a section with a twin
// elsewhere is left out rather than guessed.

import { ALL_ITEMS, STOCK_LIST } from "./stocklist";
import type { ShopCount } from "./inventory";

export type ImportResult = {
  counts: ShopCount[];
  /** Names that could not be matched to a stock line, deduplicated. */
  unknown: string[];
  /** Ambiguous names skipped, deduplicated. */
  ambiguous: string[];
};

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", sept: "09", oct: "10", nov: "11", dec: "12",
};

/** "Thu, 04 Sep 2026" or "04 Sep 2026" -> "2026-09-04". */
export function parseReportDate(s: string): string | null {
  const m = s.match(/(\d{1,2})\s+([A-Za-z]{3,4})\.?\s+(\d{4})/);
  if (!m) return null;
  const mm = MONTHS[m[2].toLowerCase()];
  if (!mm) return null;
  return `${m[3]}-${mm}-${m[1].padStart(2, "0")}`;
}

const HEADER = /stock check\s+((?:[A-Za-z]{3},\s*)?\d{1,2}\s+[A-Za-z]{3,4}\.?\s+\d{4})/i;

type Section = "reorder" | "weekly" | "ok" | "other";

function sectionOf(line: string): Section | null {
  const t = line.trim().toLowerCase();
  if (/^order these/.test(t)) return "reorder";
  if (/^weekly items/.test(t)) return "weekly";
  if (/^counted, fine/.test(t)) return "ok";
  if (/^(cups & straws|not counted|nothing below threshold)/.test(t)) return "other";
  return null;
}

/** "  - Mango: 2 left (reorder at 2)" | "Mango 2 left · reorder at 2" | "  - Mango: 5" | "Mango\t5" */
const ROW = /^\s*(?:[-•*]\s*)?([A-Za-z][A-Za-z0-9 .'’&/-]*?)\s*[:\t]?\s+(\d+(?:\.\d+)?)\s*(?:left)?\b/;

const byName = new Map<string, string[]>();
for (const cat of STOCK_LIST) {
  for (const item of cat.items) {
    const k = item.name.toLowerCase();
    byName.set(k, [...(byName.get(k) ?? []), item.id]);
  }
}
const listIndex = new Map(ALL_ITEMS.map((i, n) => [i.id, n]));

export function parseReports(text: string): ImportResult {
  const unknown = new Set<string>();
  const ambiguous = new Set<string>();
  const byDate = new Map<string, Record<string, number>>();

  // Split into one chunk per email on the header line.
  const chunks: Array<{ date: string; body: string }> = [];
  const lines = text.replace(/\r/g, "").split("\n");
  let current: { date: string; body: string[] } | null = null;
  for (const line of lines) {
    const h = line.match(HEADER);
    if (h) {
      const date = parseReportDate(h[1]);
      if (date) {
        if (current) chunks.push({ date: current.date, body: current.body.join("\n") });
        current = { date, body: [] };
        continue;
      }
    }
    if (current) current.body.push(line);
  }
  if (current) chunks.push({ date: current.date, body: current.body.join("\n") });

  for (const chunk of chunks) {
    const counts = byDate.get(chunk.date) ?? {};
    let section: Section = "other";
    // Per section, how many times each duplicate name has been seen, so the
    // second "Orange" in "Counted, fine" lands on the fruit.
    let seen = new Map<string, number>();
    for (const line of chunk.body.split("\n")) {
      const s = sectionOf(line);
      if (s) {
        section = s;
        seen = new Map();
        continue;
      }
      if (section === "other") continue;
      const m = line.match(ROW);
      if (!m) continue;
      const name = m[1].trim().replace(/\s+/g, " ");
      const qty = Number(m[2]);
      if (!Number.isFinite(qty)) continue;
      const ids = byName.get(name.toLowerCase());
      if (!ids) {
        unknown.add(name);
        continue;
      }
      let id = ids[0];
      if (ids.length > 1) {
        const n = seen.get(name.toLowerCase()) ?? 0;
        seen.set(name.toLowerCase(), n + 1);
        // Both twins in this section: positional, in list order. Only one
        // here: can't tell which — skip it.
        const twinsHere = countTwins(chunk.body, section, name);
        if (twinsHere < ids.length) {
          ambiguous.add(name);
          continue;
        }
        const ordered = [...ids].sort((a, b) => (listIndex.get(a) ?? 0) - (listIndex.get(b) ?? 0));
        id = ordered[Math.min(n, ordered.length - 1)];
      }
      counts[id] = qty;
    }
    if (Object.keys(counts).length > 0) byDate.set(chunk.date, counts);
  }

  const counts = [...byDate.entries()]
    .map(([date, c]) => ({ date, counts: c }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { counts, unknown: [...unknown], ambiguous: [...ambiguous] };
}

/** How many rows in `section` of this email carry exactly `name`. */
function countTwins(body: string, section: Section, name: string): number {
  let inSection = false;
  let n = 0;
  for (const line of body.split("\n")) {
    const s = sectionOf(line);
    if (s) {
      inSection = s === section;
      continue;
    }
    if (!inSection) continue;
    const m = line.match(ROW);
    if (m && m[1].trim().replace(/\s+/g, " ").toLowerCase() === name.toLowerCase()) n += 1;
  }
  return n;
}
