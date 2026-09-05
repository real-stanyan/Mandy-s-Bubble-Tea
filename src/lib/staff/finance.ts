// Finance: what the shop takes in and what it spends, day by day, so the
// Finance page can roll it up by day / week / month.
//
// Income  = Square sales (fetched, cached per day) + DoorDash payouts (from
//           the merchant emails, each covering a 1–2 day period).
// Cost    = ingredients + packaging (measured consumption × unit cost, from
//           the inventory) + rent (fixed monthly) + wages (typed in weekly)
//           + electricity (per bill) + anything else Stan adds.
//
// Every entry that spans a period is spread evenly across its days, so a
// fortnightly bill or a weekly payout lands on the days it belongs to rather
// than as a spike on the day the email arrived. Pure; the store does IO.

export type EntryKind = "doordash" | "electricity" | "wages" | "other-cost" | "other-income";

export type MoneyEntry = {
  id: string;
  kind: EntryKind;
  /** Inclusive Brisbane calendar days the amount covers. */
  from: string;
  to: string;
  /** AUD. Income entries positive; costs positive too (kind says which side). */
  amount: number;
  note: string;
  /** Email/thread id, invoice number — whatever makes it findable again. */
  ref: string;
  createdAt: string;
};

/** A cost that recurs on its own — rent, the warehouse, the bin contract.
 *  Charged to every day as its share of the week or the month. */
export type RecurringCost = {
  id: string;
  name: string;
  /** AUD, incl. GST where the bill is. */
  amount: number;
  per: "week" | "month";
};

export type FinanceState = {
  version: 1;
  entries: MoneyEntry[];
  recurring: RecurringCost[];
};

/** Stan, 2026-09-05: shop rent incl. water & GST; the warehouse; JJ's Waste
 *  (July 2026 invoice, incl. GST — edit when a bill differs). */
export const DEFAULT_RECURRING: RecurringCost[] = [
  { id: "rent", name: "Shop rent (incl. water & GST)", amount: 2500, per: "month" },
  { id: "warehouse", name: "Warehouse", amount: 950, per: "week" },
  { id: "waste", name: "Waste & recycling (JJ's)", amount: 319, per: "month" },
];

export const INCOME_KINDS: EntryKind[] = ["doordash", "other-income"];
export const COST_KINDS: EntryKind[] = ["electricity", "wages", "other-cost"];

export function emptyFinance(): FinanceState {
  return { version: 1, entries: [], recurring: DEFAULT_RECURRING.map((r) => ({ ...r })) };
}

export function parseFinance(value: unknown): FinanceState | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Partial<FinanceState>;
  if (!Array.isArray(v.entries)) return null;
  const entries: MoneyEntry[] = [];
  for (const e of v.entries as unknown[]) {
    const c = cleanEntry(e);
    if (c) entries.push(c);
  }
  const legacy = value as { rentMonthly?: unknown };
  let recurring: RecurringCost[] = [];
  if (Array.isArray(v.recurring)) {
    for (const r of v.recurring as unknown[]) {
      const c = cleanRecurring(r);
      if (c) recurring.push(c);
    }
  } else {
    // States written before the list existed carried only the rent.
    recurring = DEFAULT_RECURRING.map((r) =>
      r.id === "rent" && typeof legacy.rentMonthly === "number" && legacy.rentMonthly >= 0
        ? { ...r, amount: legacy.rentMonthly }
        : { ...r },
    );
  }
  return { version: 1, entries, recurring };
}

function cleanRecurring(r: unknown): RecurringCost | null {
  if (typeof r !== "object" || r === null) return null;
  const x = r as Record<string, unknown>;
  const amount = typeof x.amount === "number" ? x.amount : Number(x.amount);
  const per = x.per === "week" ? "week" : x.per === "month" ? "month" : null;
  const name = typeof x.name === "string" ? x.name.trim().slice(0, 60) : "";
  if (!per || !name || !Number.isFinite(amount) || amount < 0) return null;
  return {
    id: typeof x.id === "string" && x.id ? x.id.slice(0, 40) : `rec-${Math.random().toString(36).slice(2, 8)}`,
    name,
    amount: Math.round(amount * 100) / 100,
    per,
  };
}

/** Replace the recurring list wholesale (the editor sends all rows). */
export function setRecurring(state: FinanceState, items: unknown[]): FinanceState {
  const recurring: RecurringCost[] = [];
  for (const r of items) {
    const c = cleanRecurring(r);
    if (c) recurring.push(c);
  }
  return { ...state, recurring: recurring.slice(0, 40) };
}

const KINDS: EntryKind[] = ["doordash", "electricity", "wages", "other-cost", "other-income"];
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function cleanEntry(e: unknown): MoneyEntry | null {
  if (typeof e !== "object" || e === null) return null;
  const x = e as Record<string, unknown>;
  const kind = KINDS.includes(x.kind as EntryKind) ? (x.kind as EntryKind) : null;
  const from = typeof x.from === "string" && YMD.test(x.from) ? x.from : null;
  const to = typeof x.to === "string" && YMD.test(x.to) ? x.to : from;
  const amount = typeof x.amount === "number" ? x.amount : Number(x.amount);
  if (!kind || !from || !to || !Number.isFinite(amount) || amount < 0) return null;
  return {
    id: typeof x.id === "string" && x.id ? x.id : `${kind}-${from}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    from: from <= to ? from : to,
    to: from <= to ? to : from,
    amount: Math.round(amount * 100) / 100,
    note: typeof x.note === "string" ? x.note.slice(0, 120) : "",
    ref: typeof x.ref === "string" ? x.ref.slice(0, 80) : "",
    createdAt: typeof x.createdAt === "string" ? x.createdAt : "",
  };
}

/** Add an entry; a duplicate ref of the same kind is an update, not a second
 *  copy — re-importing the same emails must be safe. */
export function upsertEntry(state: FinanceState, input: Omit<MoneyEntry, "id" | "createdAt"> & { id?: string }, now: Date): FinanceState {
  const clean = cleanEntry({ ...input, createdAt: now.toISOString() });
  if (!clean) return state;
  const match = state.entries.findIndex(
    (e) => (input.id && e.id === input.id) || (clean.ref && e.kind === clean.kind && e.ref === clean.ref),
  );
  const entries = [...state.entries];
  if (match >= 0) entries[match] = { ...clean, id: entries[match].id, createdAt: entries[match].createdAt };
  else entries.push(clean);
  entries.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  return { ...state, entries: entries.slice(-2000) };
}

export function removeEntry(state: FinanceState, id: string): FinanceState {
  return { ...state, entries: state.entries.filter((e) => e.id !== id) };
}

// MARK: DoorDash emails

/**
 * "Your DoorDash payment for Mandys Bubble Tea (Southport) (08/31/2026 –
 * 09/01/2026)" … "Your store will receive a payment of $66.36." One email per
 * payout; the period is US-formatted MM/DD/YYYY. Handles a pasted stack of
 * emails or the print view text.
 */
export function parseDoorDashPayments(text: string): Array<{ from: string; to: string; amount: number; ref: string }> {
  const out: Array<{ from: string; to: string; amount: number; ref: string }> = [];
  // The store name carries its own parentheses — "(Southport)" — so the
  // period is found by shape, not by position after "payment for".
  const re =
    /\((\d{1,2})\/(\d{1,2})\/(\d{4})\s*[–-]\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\)[\s\S]{0,4000}?payment of \$([\d,]+\.\d{2})/gi;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = re.exec(text))) {
    const from = `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    const to = `${m[6]}-${m[4].padStart(2, "0")}-${m[5].padStart(2, "0")}`;
    const amount = Number(m[7].replace(/,/g, ""));
    const ref = `doordash:${from}..${to}:${amount.toFixed(2)}`;
    if (seen.has(ref) || !Number.isFinite(amount)) continue;
    seen.add(ref);
    out.push({ from, to, amount, ref });
  }
  return out;
}

// MARK: daily series

export type DailyPoint = {
  date: string;
  square: number;
  doordash: number;
  otherIncome: number;
  ingredients: number;
  packaging: number;
  /** Rent, warehouse, bins — the recurring list, as each day's share. */
  fixed: number;
  wages: number;
  electricity: number;
  otherCost: number;
};

export function daysBetweenYmd(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00+10:00`) - Date.parse(`${from}T00:00:00+10:00`)) / 86_400_000);
}

export function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(Date.parse(`${ymd}T00:00:00+10:00`) + n * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Brisbane", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Every day from `from` to `to` inclusive. */
export function eachDay(from: string, to: string): string[] {
  const n = daysBetweenYmd(from, to);
  if (n < 0) return [];
  return Array.from({ length: n + 1 }, (_, i) => addDaysYmd(from, i));
}

function daysInMonthOf(ymd: string): number {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function buildDaily(args: {
  from: string;
  to: string;
  squareByDay: Record<string, number>;
  consumptionByDay: Record<string, { ingredients: number; packaging: number }>;
  finance: FinanceState;
}): DailyPoint[] {
  const days = eachDay(args.from, args.to);
  const idx = new Map(days.map((d, i) => [d, i]));
  const pts: DailyPoint[] = days.map((date) => ({
    date,
    square: round2(args.squareByDay[date] ?? 0),
    doordash: 0,
    otherIncome: 0,
    ingredients: round2(args.consumptionByDay[date]?.ingredients ?? 0),
    packaging: round2(args.consumptionByDay[date]?.packaging ?? 0),
    // A day carries its share of each recurring cost: a seventh of a weekly
    // one, and for a monthly one that month's share (Feb ≠ Aug).
    fixed: round2(
      args.finance.recurring.reduce(
        (s, r) => s + (r.per === "week" ? r.amount / 7 : r.amount / daysInMonthOf(date)),
        0,
      ),
    ),
    wages: 0,
    electricity: 0,
    otherCost: 0,
  }));
  for (const e of args.finance.entries) {
    const span = eachDay(e.from, e.to);
    if (span.length === 0) continue;
    const perDay = e.amount / span.length;
    for (const d of span) {
      const i = idx.get(d);
      if (i == null) continue;
      const p = pts[i];
      if (e.kind === "doordash") p.doordash += perDay;
      else if (e.kind === "other-income") p.otherIncome += perDay;
      else if (e.kind === "wages") p.wages += perDay;
      else if (e.kind === "electricity") p.electricity += perDay;
      else p.otherCost += perDay;
    }
  }
  for (const p of pts) {
    p.doordash = round2(p.doordash);
    p.otherIncome = round2(p.otherIncome);
    p.wages = round2(p.wages);
    p.electricity = round2(p.electricity);
    p.otherCost = round2(p.otherCost);
  }
  return pts;
}

export type Granularity = "day" | "week" | "month";

export type PeriodPoint = DailyPoint & {
  /** First day of the period. */
  key: string;
  /** Last day (inclusive) actually covered — a partial current week/month. */
  end: string;
  days: number;
  label: string;
  income: number;
  cost: number;
  margin: number;
};

/** ISO-style week starting Monday, keyed by that Monday. */
export function weekStart(ymd: string): string {
  const d = new Date(Date.parse(`${ymd}T00:00:00+10:00`));
  // getUTCDay on a +10:00 midnight is off by the offset; use the Brisbane weekday.
  const wd = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", weekday: "short" }).format(d);
  const back = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[wd as "Mon"] ?? 0;
  return addDaysYmd(ymd, -back);
}

export function aggregate(points: DailyPoint[], g: Granularity): PeriodPoint[] {
  const buckets = new Map<string, PeriodPoint>();
  for (const p of points) {
    const key = g === "day" ? p.date : g === "week" ? weekStart(p.date) : `${p.date.slice(0, 7)}-01`;
    let b = buckets.get(key);
    if (!b) {
      b = {
        ...p,
        date: key,
        key,
        end: p.date,
        days: 0,
        label: labelFor(key, g),
        square: 0, doordash: 0, otherIncome: 0, ingredients: 0, packaging: 0, fixed: 0, wages: 0, electricity: 0, otherCost: 0,
        income: 0, cost: 0, margin: 0,
      };
      buckets.set(key, b);
    }
    b.days += 1;
    b.end = p.date;
    for (const k of ["square", "doordash", "otherIncome", "ingredients", "packaging", "fixed", "wages", "electricity", "otherCost"] as const) {
      b[k] = round2(b[k] + p[k]);
    }
  }
  const out = [...buckets.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  for (const b of out) {
    b.income = round2(b.square + b.doordash + b.otherIncome);
    b.cost = round2(b.ingredients + b.packaging + b.fixed + b.wages + b.electricity + b.otherCost);
    b.margin = round2(b.income - b.cost);
  }
  return out;
}

function labelFor(key: string, g: Granularity): string {
  const d = new Date(Date.parse(`${key}T00:00:00+10:00`));
  const tz = "Australia/Brisbane";
  if (g === "month") return new Intl.DateTimeFormat("en-AU", { timeZone: tz, month: "short", year: "numeric" }).format(d);
  if (g === "week") return "wk " + new Intl.DateTimeFormat("en-AU", { timeZone: tz, day: "numeric", month: "short" }).format(d);
  return new Intl.DateTimeFormat("en-AU", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(d);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
