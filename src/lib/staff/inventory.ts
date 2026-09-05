// Warehouse inventory: what Stan holds off-site, what the shop burns through
// each day, and what to carry over each morning.
//
// Two stocks, deliberately kept apart:
//
//   * the SHOP count — what staff type into the stock-check sheet every day
//     (stocklist.ts). It already exists; this file only reads it.
//   * the WAREHOUSE quantity — what is still in storage. Only this file knows
//     about it. It goes down when a pickup is confirmed and up when Stan edits
//     the number after a supplier delivery.
//
// Daily usage is not typed in; it is measured. Two consecutive shop counts,
// plus whatever was carried in between, give how much the shop used per day:
//
//     usage = (count_before + delivered − count_after) / days
//
// A pickup list is then "enough to last COVER_DAYS at the shop": bring the
// gap between what the shop has and COVER_DAYS × usage, never more than the
// warehouse holds. Everything here is pure so it can be tested without a
// database; inventory-store.ts does the reading and writing.

import { STOCK_LIST, type StockItem } from "./stocklist";

export const INVENTORY_VERSION = 1;

/** How many days a single pickup has to cover at the shop, by default. */
export const DEFAULT_COVER_DAYS = 3;

/** Usage is averaged over readings inside this window, so a change in what
 *  sells (a hot week, a new special) shows up within a fortnight. */
export const USAGE_WINDOW_DAYS = 21;

export type InventoryItem = {
  /** Stable id. Items that mirror a stock-check line share its id
   *  (e.g. `syrup-mango`) so the shop count can be looked up; items Stan adds
   *  by hand get a `custom-` id and have no shop count. */
  id: string;
  name: string;
  /** Free text; the seed uses the stock-check category names. */
  category: string;
  /** Free text — bottles, bags, boxes. Blank is fine. */
  unit: string;
  /** Warehouse quantity. Null = not entered yet. */
  qty: number | null;
  /** Reorder alert when qty is at or below this. Null = no alert. */
  threshold: number | null;
  /** Daily usage typed by hand, which wins over the measured figure. */
  usageOverride: number | null;
  /** True when a stock-check line with this id is counted as a number.
   *  False for sufficiency items (cups, straws) and custom items. */
  hasShopCount: boolean;
  /** Kept in the warehouse (quantity tracked, pickups decrement it). False
   *  for things bought as needed — fresh milk, fruit — which still appear on
   *  the pickup list as "buy" so the morning run covers them too. */
  inWarehouse: boolean;
  /** AUD ex-GST per count unit, for the weekly cost view. Null = unknown. */
  unitCost: number | null;
  /** Where the price came from — an invoice number, "Stan 2026-09-05". */
  costSource: string;
  updatedAt: string;
};

export type PickupLine = { id: string; qty: number };

export type PickupRecord = {
  /** Brisbane calendar day the goods reached the shop. */
  date: string;
  at: string;
  by: string | null;
  lines: PickupLine[];
};

export type ShopCount = {
  /** Brisbane calendar day of the stock check. */
  date: string;
  /** stock-check item id -> counted quantity. Blank and non-numeric entries
   *  are not stored. */
  counts: Record<string, number>;
};

export type InventoryState = {
  version: typeof INVENTORY_VERSION;
  coverDays: number;
  items: InventoryItem[];
  /** Oldest first. */
  pickups: PickupRecord[];
  /** Oldest first, one per day (a second count on the same day replaces). */
  shopCounts: ShopCount[];
  /** Which one-off cost seed has been applied (see ensureCosts). */
  costsSeeded?: number;
};

/** Warehouse quantities Stan gave on 2026-09-05, keyed by stock-check id. */
export const INITIAL_WAREHOUSE_QTY: Record<string, number> = {
  "syrup-honeydew": 72,
  "syrup-lemon": 72,
  "syrup-blueberry": 66,
  "syrup-orange": 72,
  "syrup-strawberry": 126,
  "syrup-grape": 112,
  "syrup-pf": 138,
  "syrup-ga": 84,
  "syrup-gf": 96,
  "syrup-mango": 114,
  "syrup-lychee": 48,
  "syrup-peach": 90,
  "syrup-guava": 72,
  "topping-mango-jelly": 60,
  "topping-lychee-jelly": 20,
  "powder-matcha": 70,
  "powder-pudding": 40,
  "powder-thai": 20,
  "powder-coconut": 6,
};

/**
 * The starting inventory: every daily stock-check line, with the quantities
 * Stan gave where he gave them and blanks everywhere else. Weekly (Tuesday)
 * lines are left out on purpose — they are ordered on a different rhythm and
 * he asked for them not to be here.
 */
export function seedState(now: Date, lastShopCount: ShopCount | null = null): InventoryState {
  const at = now.toISOString();
  const items: InventoryItem[] = [];
  for (const cat of STOCK_LIST) {
    for (const item of cat.items) {
      if (item.rule.kind === "weekly") continue;
      items.push({
        id: item.id,
        name: item.name,
        category: cat.name,
        unit: "",
        qty: INITIAL_WAREHOUSE_QTY[item.id] ?? null,
        threshold: null,
        usageOverride: null,
        hasShopCount: item.rule.kind !== "sufficiency",
        inWarehouse: true,
        unitCost: null,
        costSource: "",
        updatedAt: at,
      });
    }
  }
  return {
    version: INVENTORY_VERSION,
    coverDays: DEFAULT_COVER_DAYS,
    items,
    pickups: [],
    shopCounts: lastShopCount ? [lastShopCount] : [],
  };
}

/**
 * Every numeric daily stock-check line has a row, even after Stan removes it
 * from the warehouse: the pickup list has to cover the whole morning run,
 * bought and carried alike. Lines that are missing (removed before this
 * existed, or newly added to stocklist.ts) come back as shop-only rows.
 */
export function ensureShopLines(state: InventoryState, now: Date): { state: InventoryState; added: number } {
  const have = new Set(state.items.map((i) => i.id));
  const at = now.toISOString();
  const extra: InventoryItem[] = [];
  for (const cat of STOCK_LIST) {
    for (const item of cat.items) {
      if (item.rule.kind !== "threshold" || have.has(item.id)) continue;
      extra.push({
        id: item.id,
        name: item.name,
        category: cat.name,
        unit: "",
        qty: null,
        threshold: null,
        usageOverride: null,
        hasShopCount: true,
        inWarehouse: false,
        unitCost: null,
        costSource: "",
        updatedAt: at,
      });
    }
  }
  if (extra.length === 0) return { state, added: 0 };
  return { state: { ...state, items: [...state.items, ...extra] }, added: extra.length };
}

/** The stock-check line an inventory item mirrors, if any. */
export function stockLineFor(id: string): StockItem | undefined {
  for (const cat of STOCK_LIST) {
    const hit = cat.items.find((i) => i.id === id);
    if (hit) return hit;
  }
  return undefined;
}

/** Turn a raw stock-check submission into a ShopCount, dropping blanks and
 *  the sufficiency answers (enough/maybe/short are not quantities). */
export function shopCountFromRaw(date: string, raw: Record<string, string>): ShopCount {
  const counts: Record<string, number> = {};
  for (const [id, value] of Object.entries(raw)) {
    const n = Number((value ?? "").trim());
    if ((value ?? "").trim() === "" || !Number.isFinite(n) || n < 0) continue;
    counts[id] = n;
  }
  return { date, counts };
}

/** Days from `from` to `to` (both YYYY-MM-DD). Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00+10:00`);
  const b = Date.parse(`${to}T00:00:00+10:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** Quantity of `itemId` carried to the shop on days in (after, upTo]. */
function deliveredBetween(
  pickups: PickupRecord[],
  itemId: string,
  after: string,
  upTo: string,
): number {
  let sum = 0;
  for (const p of pickups) {
    if (p.date <= after || p.date > upTo) continue;
    for (const line of p.lines) if (line.id === itemId) sum += line.qty;
  }
  return sum;
}

export type UsageEstimate = {
  /** Units per day, or null when there is not enough history yet. */
  perDay: number | null;
  /** How many day-intervals the estimate rests on. 0 = nothing yet. */
  intervals: number;
  /** Days of history behind the estimate. */
  spanDays: number;
};

/**
 * Measured daily usage from the shop counts.
 *
 * Each pair of consecutive readings inside the window contributes
 * (before + delivered − after) / days, weighted by days so a reading gap of
 * three days counts as three days, not one. A negative interval — the shop
 * counted MORE than it could have had — means a miscount or a delivery that
 * was never confirmed; it is skipped rather than allowed to drag the average
 * below what the shop really uses, because an underestimate is the failure
 * that leaves a shelf empty.
 */
export function estimateUsage(
  itemId: string,
  shopCounts: ShopCount[],
  pickups: PickupRecord[],
  today: string,
  windowDays: number = USAGE_WINDOW_DAYS,
): UsageEstimate {
  const inWindow = shopCounts
    .filter((c) => c.counts[itemId] != null && daysBetween(c.date, today) <= windowDays)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  // A reading far above the item's own median is a slipped keypad — "10"
  // for 1.0, "85" for 0.85 — not a delivery. Left in, one such day books a
  // week's worth of phantom usage (herbal jelly read 15/wk instead of 2).
  // Dropped only when it is both ≥5 and >4× the median, so a genuinely
  // busy item with big counts (milk at 20–40) is never touched.
  const typo = typoThreshold(inWindow.map((c) => c.counts[itemId]));
  const readings = typo == null ? inWindow : inWindow.filter((c) => c.counts[itemId] < typo);

  let used = 0;
  let days = 0;
  let intervals = 0;
  for (let i = 1; i < readings.length; i++) {
    const a = readings[i - 1];
    const b = readings[i];
    const d = daysBetween(a.date, b.date);
    if (d <= 0) continue;
    const delta = a.counts[itemId] + deliveredBetween(pickups, itemId, a.date, b.date) - b.counts[itemId];
    if (delta < 0) continue;
    used += delta;
    days += d;
    intervals += 1;
  }
  if (days === 0) return { perDay: null, intervals: 0, spanDays: 0 };
  return { perDay: used / days, intervals, spanDays: days };
}

/** Readings at or above this are treated as keypad slips; null = no filter
 *  (fewer than four readings, or a median of zero). Exported for tests. */
export function typoThreshold(values: number[]): number | null {
  if (values.length < 4) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (!(median > 0)) return null;
  return Math.max(5, median * 4 + 1e-9);
}

/** The most recent shop count for an item, plus anything carried in on or
 *  after that day (assumed to arrive after the count was taken). */
export function shopOnHand(
  itemId: string,
  shopCounts: ShopCount[],
  pickups: PickupRecord[],
): { qty: number; countedOn: string } | null {
  let latest: ShopCount | null = null;
  for (const c of shopCounts) {
    if (c.counts[itemId] == null) continue;
    if (!latest || c.date > latest.date) latest = c;
  }
  if (!latest) return null;
  let qty = latest.counts[itemId];
  for (const p of pickups) {
    if (p.date < latest.date) continue;
    for (const line of p.lines) if (line.id === itemId) qty += line.qty;
  }
  return { qty, countedOn: latest.date };
}

export type PickupSuggestion = {
  /** Whole units to carry today. 0 = the shop is covered. */
  bring: number;
  /** Why the number is what it is, for the row caption. */
  reason:
    | "covered"
    | "topup"
    | "no-usage"
    | "no-shop-count"
    | "warehouse-empty"
    | "warehouse-short";
};

/**
 * How much to carry so the shop lasts `coverDays`.
 *
 * `shopQty` null means nobody has counted this item yet; the whole cover is
 * suggested and the row says so, which is safer than assuming the shelf is
 * full. Usage null means there is nothing to compute from, so nothing is
 * suggested — a made-up number would be worse than a visible blank.
 */
export function suggestPickup(
  usagePerDay: number | null,
  shopQty: number | null,
  warehouseQty: number | null,
  coverDays: number,
): PickupSuggestion {
  if (usagePerDay == null || usagePerDay <= 0) return { bring: 0, reason: "no-usage" };
  const need = usagePerDay * coverDays;
  const have = shopQty ?? 0;
  let bring = Math.max(0, Math.ceil(need - have - 1e-9));
  if (bring === 0) return { bring: 0, reason: "covered" };
  let reason: PickupSuggestion["reason"] = shopQty == null ? "no-shop-count" : "topup";
  if (warehouseQty != null) {
    if (warehouseQty <= 0) return { bring: 0, reason: "warehouse-empty" };
    if (bring > warehouseQty) {
      bring = Math.floor(warehouseQty);
      reason = "warehouse-short";
    }
  }
  return { bring, reason };
}

export function isLow(item: Pick<InventoryItem, "qty" | "threshold">): boolean {
  return item.qty != null && item.threshold != null && item.qty <= item.threshold;
}

/** One row of the page: the stored item plus everything derived from it. */
export type InventoryRow = InventoryItem & {
  /** Carried from the warehouse, or bought on the way. */
  kind: "warehouse" | "buy";
  usage: UsageEstimate;
  /** Override if set, else the measured figure. */
  usagePerDay: number | null;
  usageSource: "override" | "measured" | "none";
  shop: { qty: number; countedOn: string } | null;
  /** Days the shop's current stock lasts at the current usage. */
  shopCoverDays: number | null;
  /** Days the warehouse lasts at the current usage. */
  warehouseCoverDays: number | null;
  low: boolean;
  suggestion: PickupSuggestion;
  /** usage × 7 × unitCost; null when either side is unknown. */
  weeklyCost: number | null;
};

export type CostSummary = {
  /** Items with a cost and a usage figure, split by the Packaging category. */
  ingredientsWeekly: number;
  packagingWeekly: number;
  /** Items that have a usage figure but no unit cost yet. */
  missingCost: string[];
  /** Items with a cost but nothing to multiply it by yet. */
  missingUsage: string[];
  /** Largest weekly costs first. */
  top: Array<{ id: string; name: string; weeklyCost: number }>;
};

export type InventoryView = {
  today: string;
  coverDays: number;
  rows: InventoryRow[];
  /** Pickups confirmed today, newest last. */
  todaysPickups: PickupRecord[];
  lastShopCountDate: string | null;
  /** Today's stock check has been submitted — the pickup list is only shown
   *  once it has, because it is computed from it. */
  countedToday: boolean;
  cost: CostSummary;
};

export function buildView(state: InventoryState, today: string): InventoryView {
  const rows: InventoryRow[] = state.items.map((item) => {
    const usage = item.hasShopCount
      ? estimateUsage(item.id, state.shopCounts, state.pickups, today)
      : { perDay: null, intervals: 0, spanDays: 0 };
    const usagePerDay = item.usageOverride ?? usage.perDay;
    const usageSource: InventoryRow["usageSource"] =
      item.usageOverride != null ? "override" : usage.perDay != null ? "measured" : "none";
    const shop = item.hasShopCount ? shopOnHand(item.id, state.shopCounts, state.pickups) : null;
    const cover = (qty: number | null) =>
      qty == null || usagePerDay == null || usagePerDay <= 0 ? null : qty / usagePerDay;
    // A bought item has no warehouse to run short of, so no cap applies.
    const cap = item.inWarehouse ? item.qty : null;
    return {
      ...item,
      kind: item.inWarehouse ? "warehouse" : "buy",
      usage,
      usagePerDay,
      usageSource,
      shop,
      shopCoverDays: cover(shop?.qty ?? null),
      warehouseCoverDays: item.inWarehouse ? cover(item.qty) : null,
      low: item.inWarehouse && isLow(item),
      // An item that is never counted (creamer, pearls, cups) has no shop
      // figure to top up from, so it gets no daily suggestion — Stan buys
      // those on their own rhythm. It still carries usage for the cost view.
      suggestion: item.hasShopCount
        ? suggestPickup(usagePerDay, shop?.qty ?? null, cap, state.coverDays)
        : { bring: 0, reason: "no-shop-count" },
      weeklyCost:
        usagePerDay != null && item.unitCost != null
          ? Math.round(usagePerDay * 7 * item.unitCost * 100) / 100
          : null,
    };
  });
  const cost: CostSummary = { ingredientsWeekly: 0, packagingWeekly: 0, missingCost: [], missingUsage: [], top: [] };
  for (const r of rows) {
    if (r.weeklyCost != null) {
      if (r.category === "Packaging") cost.packagingWeekly += r.weeklyCost;
      else cost.ingredientsWeekly += r.weeklyCost;
      if (r.weeklyCost > 0) cost.top.push({ id: r.id, name: r.name, weeklyCost: r.weeklyCost });
    } else if (r.usagePerDay != null && r.usagePerDay > 0 && r.unitCost == null) {
      cost.missingCost.push(r.name);
    } else if (r.unitCost != null && r.usagePerDay == null) {
      cost.missingUsage.push(r.name);
    }
  }
  cost.ingredientsWeekly = Math.round(cost.ingredientsWeekly);
  cost.packagingWeekly = Math.round(cost.packagingWeekly);
  cost.top.sort((a, b) => b.weeklyCost - a.weeklyCost);
  cost.top = cost.top.slice(0, 10);
  let lastShopCountDate: string | null = null;
  for (const c of state.shopCounts) {
    if (!lastShopCountDate || c.date > lastShopCountDate) lastShopCountDate = c.date;
  }
  return {
    today,
    coverDays: state.coverDays,
    rows,
    todaysPickups: state.pickups.filter((p) => p.date === today),
    lastShopCountDate,
    countedToday: lastShopCountDate === today,
    cost,
  };
}

/** YYYY-MM-DD plus n days, in Brisbane. */
export function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(Date.parse(`${ymd}T00:00:00+10:00`) + n * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Brisbane", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/**
 * What the shop consumed each day, in dollars, split ingredients / packaging.
 *
 * Counted items: each pair of consecutive counts (typo readings dropped, the
 * same filter as estimateUsage) gives (before + delivered − after), spread
 * evenly over the days between the two counts — the days the drinks were
 * actually made. Items with a usage override (creamer, pearls, cups) cost
 * the same every day. Days before the first count carry nothing; the
 * Finance page says so rather than pretending zero was spent.
 */
export function consumptionCostByDay(
  state: InventoryState,
  from: string,
  to: string,
): Record<string, { ingredients: number; packaging: number }> {
  const out: Record<string, { ingredients: number; packaging: number }> = {};
  const add = (day: string, packaging: boolean, dollars: number) => {
    if (day < from || day > to || !(dollars > 0)) return;
    const o = (out[day] ??= { ingredients: 0, packaging: 0 });
    if (packaging) o.packaging += dollars;
    else o.ingredients += dollars;
  };
  const days = daysBetween(from, to) + 1;
  for (const item of state.items) {
    if (item.unitCost == null || item.unitCost <= 0) continue;
    const packaging = item.category === "Packaging";
    if (item.usageOverride != null || !item.hasShopCount) {
      if (item.usageOverride == null) continue;
      for (let k = 0; k < days; k++) add(addDaysYmd(from, k), packaging, item.usageOverride * item.unitCost);
      continue;
    }
    const all = state.shopCounts
      .filter((c) => c.counts[item.id] != null)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const typo = typoThreshold(all.map((c) => c.counts[item.id]));
    const readings = typo == null ? all : all.filter((c) => c.counts[item.id] < typo);
    for (let i = 1; i < readings.length; i++) {
      const a = readings[i - 1];
      const b = readings[i];
      const d = daysBetween(a.date, b.date);
      if (d <= 0 || d > 7) continue;
      let delivered = 0;
      for (const p of state.pickups) {
        if (p.date <= a.date || p.date > b.date) continue;
        for (const line of p.lines) if (line.id === item.id) delivered += line.qty;
      }
      const delta = a.counts[item.id] + delivered - b.counts[item.id];
      if (delta < 0) continue;
      const perDay = (delta / d) * item.unitCost;
      for (let k = 0; k < d; k++) add(addDaysYmd(a.date, k), packaging, perDay);
    }
  }
  for (const o of Object.values(out)) {
    o.ingredients = Math.round(o.ingredients * 100) / 100;
    o.packaging = Math.round(o.packaging * 100) / 100;
  }
  return out;
}

/** Apply a confirmed pickup: log it and take it out of the warehouse.
 *  Items with no warehouse quantity yet stay null — there is nothing to
 *  subtract from, and inventing a negative number would only mislead. */
export function applyPickup(
  state: InventoryState,
  lines: PickupLine[],
  date: string,
  by: string | null,
  now: Date,
): InventoryState {
  const clean = lines
    .map((l) => ({ id: l.id, qty: Number(l.qty) }))
    .filter((l) => Number.isFinite(l.qty) && l.qty > 0 && state.items.some((i) => i.id === l.id));
  if (clean.length === 0) return state;
  const at = now.toISOString();
  const taken = new Map(clean.map((l) => [l.id, l.qty]));
  return {
    ...state,
    items: state.items.map((item) => {
      const q = taken.get(item.id);
      // Bought items are logged (they count as delivered for the usage
      // maths) but there is no warehouse figure to take them out of.
      if (q == null || item.qty == null || !item.inWarehouse) return item;
      return { ...item, qty: Math.max(0, round2(item.qty - q)), updatedAt: at };
    }),
    pickups: [...state.pickups, { date, at, by, lines: clean }].slice(-400),
  };
}

/** Replace the day's shop count (a second submission on the same day wins). */
export function recordShopCount(state: InventoryState, count: ShopCount): InventoryState {
  const others = state.shopCounts.filter((c) => c.date !== count.date);
  return {
    ...state,
    shopCounts: [...others, count]
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .slice(-120),
  };
}

/** Fold historical counts in. A day the live route already recorded wins:
 *  it came from the form itself, the import from a copy of an email. */
export function mergeShopCounts(state: InventoryState, imported: ShopCount[]): { state: InventoryState; added: number } {
  const have = new Set(state.shopCounts.map((c) => c.date));
  let next = state;
  let added = 0;
  for (const c of imported) {
    if (have.has(c.date) || Object.keys(c.counts).length === 0) continue;
    next = recordShopCount(next, c);
    added += 1;
  }
  return { state: next, added };
}

export type ItemPatch = {
  id: string;
  name?: string;
  category?: string;
  unit?: string;
  qty?: number | null;
  threshold?: number | null;
  usageOverride?: number | null;
  unitCost?: number | null;
  costSource?: string;
};

/** Merge edits into existing items. Unknown ids are ignored — adding is a
 *  separate, explicit action so a typo in an id cannot spawn a phantom row. */
export function patchItems(state: InventoryState, patches: ItemPatch[], now: Date): InventoryState {
  const at = now.toISOString();
  const byId = new Map(patches.map((p) => [p.id, p]));
  return {
    ...state,
    items: state.items.map((item) => {
      const p = byId.get(item.id);
      if (!p) return item;
      return {
        ...item,
        name: cleanName(p.name) ?? item.name,
        category: cleanName(p.category) ?? item.category,
        unit: p.unit === undefined ? item.unit : p.unit.trim(),
        qty: p.qty === undefined ? item.qty : cleanQty(p.qty),
        threshold: p.threshold === undefined ? item.threshold : cleanQty(p.threshold),
        usageOverride: p.usageOverride === undefined ? item.usageOverride : cleanQty(p.usageOverride),
        unitCost: p.unitCost === undefined ? item.unitCost : cleanQty(p.unitCost),
        costSource:
          p.costSource !== undefined
            ? p.costSource.trim().slice(0, 80)
            : p.unitCost !== undefined && cleanQty(p.unitCost) !== item.unitCost
              ? "edited on the page"
              : item.costSource,
        updatedAt: at,
      };
    }),
  };
}

export function addItem(
  state: InventoryState,
  input: { name: string; category: string; unit?: string; qty?: number | null; threshold?: number | null },
  now: Date,
): { state: InventoryState; item: InventoryItem | null } {
  const name = cleanName(input.name);
  const category = cleanName(input.category) ?? "Others";
  if (!name) return { state, item: null };
  const base = `custom-${slug(name)}`;
  let id = base;
  for (let n = 2; state.items.some((i) => i.id === id); n++) id = `${base}-${n}`;
  const item: InventoryItem = {
    id,
    name,
    category,
    unit: (input.unit ?? "").trim(),
    qty: cleanQty(input.qty ?? null),
    threshold: cleanQty(input.threshold ?? null),
    usageOverride: null,
    hasShopCount: false,
    inWarehouse: true,
    unitCost: null,
    costSource: "",
    updatedAt: now.toISOString(),
  };
  return { state: { ...state, items: [...state.items, item] }, item };
}

// MARK: costs

/**
 * Unit costs per count unit, AUD ex-GST, as gathered on 2026-09-05
 * (`~/mandy/operations/ingredient-costs.md`). Taiwan FOB prices carry the
 * quote's own 8% FOB/pallet overhead; sea freight is not in them. RMB items
 * are converted at 4.7. These are the STARTING numbers — Stan edits the
 * column on the page, and the seed never overwrites an edit.
 */
const TW = (p: number) => Math.round(p * 1.08 * 100) / 100;
const RMB = (p: number) => Math.round((p / 4.7) * 1000) / 1000;
export const DEFAULT_UNIT_COSTS: Record<string, { cost: number; source: string }> = {
  "syrup-mango": { cost: TW(8.31), source: "Tachungho QE40029 FOB +8%" },
  "syrup-peach": { cost: TW(7.85), source: "Tachungho QE40029 FOB +8%" },
  "syrup-lychee": { cost: TW(7.85), source: "Tachungho QE40029 FOB +8%" },
  "syrup-strawberry": { cost: TW(8.31), source: "Tachungho QE40029 FOB +8%" },
  "syrup-pf": { cost: TW(9.0), source: "Tachungho QE40029 FOB +8%" },
  "syrup-grape": { cost: TW(8.54), source: "Tachungho QE40029 FOB +8%" },
  "syrup-ga": { cost: TW(7.85), source: "Tachungho QE40029 FOB +8%" },
  "syrup-pa": { cost: TW(7.85), source: "Tachungho QE40029 FOB +8% (pineapple)" },
  "syrup-gf": { cost: TW(10.39), source: "Tachungho QE40029 FOB +8%" },
  "syrup-lemon": { cost: TW(7.85), source: "Tachungho QE40029 FOB +8%" },
  "syrup-lymt": { cost: 18, source: "Stan 2026-09-05" },
  "syrup-blueberry": { cost: TW(9.23), source: "Tachungho QE40029 FOB +8%" },
  "syrup-guava": { cost: TW(8.77), source: "Tachungho QE40029 FOB +8%" },
  "syrup-yogurt": { cost: 18, source: "MBT (6 btl/ctn $108)" },
  "syrup-honeydew": { cost: TW(7.85), source: "Stan: same as other TW syrups" },
  "syrup-orange": { cost: TW(7.85), source: "Tachungho QE40029 FOB +8%" },
  "syrup-brown-sugar": { cost: 27.5, source: "MBT 144341 (4 btl/ctn $110)" },
  "syrup-tiger-brown-sugar": { cost: 38, source: "MBT 144341" },
  "syrup-strawberry-jam": { cost: 28, source: "local invoice" },
  "topping-lychee-jelly": { cost: TW(8.54), source: "Tachungho QE40029 FOB +8%" },
  "topping-mango-jelly": { cost: TW(8.54), source: "Tachungho QE40029 FOB +8%" },
  "topping-aloe-vera": { cost: RMB(10.5), source: "Stan: 10.5 RMB @4.7" },
  "topping-rainbow": { cost: RMB(20), source: "Stan: 20 RMB @4.7" },
  "topping-strawberry-popping": { cost: RMB(17), source: "Stan: 17 RMB @4.7" },
  "topping-jellyball": { cost: RMB(11.5), source: "Stan: 11.5 RMB @4.7" },
  "topping-herbal-jelly": { cost: 11, source: "MBT 144341 grass jelly powder $22/kg, 1 bag = 2 units" },
  "topping-green-apple-popping": { cost: RMB(17), source: "Stan: 17 RMB @4.7" },
  "topping-oat-popping": { cost: RMB(16.5), source: "Stan: 16.5 RMB @4.7" },
  "topping-chocolate-popping": { cost: RMB(20.5), source: "Stan: 20.5 RMB @4.7" },
  "powder-matcha": { cost: TW(10.16), source: "Tachungho QE40029 FOB +8%" },
  "powder-coconut": { cost: TW(9.46), source: "Tachungho QE40029 FOB +8%" },
  "powder-silver-taro": { cost: 15, source: "MBT (20 bag/ctn $300)" },
  "powder-colorful-taro": { cost: 15, source: "local invoice" },
  "powder-thai": { cost: 10, source: "Stan 2026-09-05" },
  "powder-brulee": { cost: RMB(40), source: "Stan: 40 RMB @4.7" },
  "powder-pudding": { cost: TW(7.85), source: "Tachungho QE40029 FOB +8%" },
  "tea-black-fannings": { cost: 16, source: "MBT 144341 (600g bag)" },
  "tea-green": { cost: TW(8.77), source: "Tachungho QE40029 FOB +8% (600g bag)" },
  "packaging-cups": { cost: RMB(0.26), source: "Stan: 0.26 RMB @4.7 (700ml, 13g)" },
  "packaging-straws": { cost: RMB(0.11), source: "Stan: 0.13 thick / 0.09 thin RMB, half each @4.7" },
  "other-fresh-milk": { cost: 1.79, source: "Stan 2026-09-05" },
  "other-oat-milk": { cost: 2, source: "Stan 2026-09-05" },
  "other-soy-milk": { cost: 2, source: "Stan 2026-09-05" },
  "other-almond-milk": { cost: 2, source: "Stan 2026-09-05" },
  "other-cream": { cost: 5.9, source: "Stan 2026-09-05" },
  "other-condensed-milk": { cost: 3, source: "Stan 2026-09-05" },
  "other-ice-cream": { cost: 6.5, source: "Stan 2026-09-05" },
  "other-raw-sugar": { cost: 3.9, source: "Stan 2026-09-05" },
  "other-oreo": { cost: 1.6, source: "Stan 2026-09-05" },
  "other-pf-seeds": { cost: 1.8, source: "Stan 2026-09-05" },
};

/** Things that cost money every week but are not on the count sheet. Usage
 *  is Stan's figure (per day), edited on the page like any override. Cups
 *  and straws ride the August average of 364 cups a day. */
const COST_EXTRAS: Array<{
  id: string; name: string; category: string; unit: string; usagePerDay: number; cost: number; source: string; inWarehouse: boolean;
}> = [
  { id: "custom-tapioca-pearls", name: "Tapioca Pearls", category: "Topping", unit: "ctn", usagePerDay: 0.5, cost: 45, source: "MBT 142872: B3G1, $180 per 4 ctn; Stan 3.5 ctn/wk", inWarehouse: false },
  { id: "custom-okinawa-creamer", name: "Okinawa Creamer", category: "Powder", unit: "ctn 20kg", usagePerDay: 0.5, cost: 220, source: "MBT 144341; Stan 3.5 ctn/wk", inWarehouse: false },
  { id: "custom-coffee-mate-creamer", name: "Coffee Mate Creamer", category: "Powder", unit: "ctn 20×1kg", usagePerDay: 1 / 7, cost: 260, source: "MBT 144341 $13/bag; Stan 1 ctn/wk", inWarehouse: false },
  { id: "custom-sealing-film", name: "Sealing film", category: "Packaging", unit: "pcs", usagePerDay: 364, cost: RMB(0.05), source: "Stan: 0.05 RMB @4.7; 364 cups/day (Aug avg)", inWarehouse: false },
  { id: "custom-cup-sticker", name: "Cup sticker", category: "Packaging", unit: "pcs", usagePerDay: 364, cost: RMB(0.024), source: "Stan: 0.024 RMB @4.7; 364 cups/day (Aug avg)", inWarehouse: false },
];

/** Deliberately not costed (Stan, 2026-09-05): fruit is out of scope and
 *  tissue / bin bags are not ingredients. A cost of 0 says "decided", as
 *  opposed to null, "unknown". */
const NOT_COSTED = [
  "other-orange", "other-grapefruit", "other-lemon", "other-lime", "other-watermelon", "other-banana",
  "other-tissue", "other-black-garbage-bag",
];

/** Apply the cost seeds once each: v1 fills blank unit costs, adds the
 *  off-sheet items and gives cups/straws a usage figure; v2 marks the
 *  not-costed items. Never touches a cost or override that is already set. */
export function ensureCosts(state: InventoryState, now: Date): { state: InventoryState; changed: boolean } {
  const seeded = state.costsSeeded ?? 0;
  if (seeded >= 2) return { state, changed: false };
  const at = now.toISOString();
  if (seeded === 1) {
    return {
      state: {
        ...state,
        costsSeeded: 2,
        items: state.items.map((i) =>
          NOT_COSTED.includes(i.id) && i.unitCost == null
            ? { ...i, unitCost: 0, costSource: "not counted (Stan 2026-09-05)", updatedAt: at }
            : i,
        ),
      },
      changed: true,
    };
  }
  const items = state.items.map((i) => {
    const d = DEFAULT_UNIT_COSTS[i.id];
    let next = i;
    if (d && i.unitCost == null) next = { ...next, unitCost: d.cost, costSource: d.source, updatedAt: at };
    if (!d && NOT_COSTED.includes(i.id) && i.unitCost == null) {
      next = { ...next, unitCost: 0, costSource: "not counted (Stan 2026-09-05)", updatedAt: at };
    }
    if ((i.id === "packaging-cups" || i.id === "packaging-straws") && i.usageOverride == null) {
      next = { ...next, usageOverride: 364, updatedAt: at };
    }
    return next;
  });
  const have = new Set(items.map((i) => i.id));
  for (const x of COST_EXTRAS) {
    if (have.has(x.id)) continue;
    items.push({
      id: x.id, name: x.name, category: x.category, unit: x.unit, qty: null, threshold: null,
      usageOverride: Math.round(x.usagePerDay * 1000) / 1000, hasShopCount: false, inWarehouse: x.inWarehouse,
      unitCost: x.cost, costSource: x.source, updatedAt: at,
    });
  }
  return { state: { ...state, items, costsSeeded: 2 }, changed: true };
}

/**
 * Take an item out of the warehouse. A stock-check line stays as a
 * shop-only row — it is still counted every day and still has to be bought
 * — so only its warehouse fields are cleared. A custom item has nothing
 * else keeping it, so it goes.
 */
export function removeItem(state: InventoryState, id: string, now: Date = new Date()): InventoryState {
  const at = now.toISOString();
  return {
    ...state,
    items: state.items.flatMap((i) => {
      if (i.id !== id) return [i];
      if (!i.hasShopCount) return [];
      return [{ ...i, inWarehouse: false, qty: null, threshold: null, updatedAt: at }];
    }),
  };
}

/** Start keeping a shop-only item in the warehouse again. */
export function trackItem(state: InventoryState, id: string, now: Date = new Date()): InventoryState {
  const at = now.toISOString();
  return {
    ...state,
    items: state.items.map((i) => (i.id === id && !i.inWarehouse ? { ...i, inWarehouse: true, updatedAt: at } : i)),
  };
}

export function setCoverDays(state: InventoryState, coverDays: number): InventoryState {
  const n = Number(coverDays);
  if (!Number.isFinite(n) || n < 1 || n > 30) return state;
  return { ...state, coverDays: Math.round(n) };
}

/** Accept what came out of JSON as a state, or null if it is not one. */
export function parseState(value: unknown): InventoryState | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Partial<InventoryState>;
  if (!Array.isArray(v.items)) return null;
  return {
    version: INVENTORY_VERSION,
    coverDays:
      typeof v.coverDays === "number" && v.coverDays >= 1 ? Math.round(v.coverDays) : DEFAULT_COVER_DAYS,
    items: v.items
      .filter((i): i is InventoryItem => typeof i === "object" && i !== null && typeof i.id === "string")
      .map((i) => ({
        id: i.id,
        name: typeof i.name === "string" ? i.name : i.id,
        category: typeof i.category === "string" ? i.category : "Others",
        unit: typeof i.unit === "string" ? i.unit : "",
        qty: cleanQty(i.qty),
        threshold: cleanQty(i.threshold),
        usageOverride: cleanQty(i.usageOverride),
        hasShopCount: Boolean(i.hasShopCount),
        // Rows written before this flag existed were all warehouse rows.
        inWarehouse: i.inWarehouse === undefined ? true : Boolean(i.inWarehouse),
        unitCost: cleanQty(i.unitCost),
        costSource: typeof i.costSource === "string" ? i.costSource : "",
        updatedAt: typeof i.updatedAt === "string" ? i.updatedAt : "",
      })),
    pickups: Array.isArray(v.pickups) ? v.pickups : [],
    shopCounts: Array.isArray(v.shopCounts) ? v.shopCounts : [],
    costsSeeded: typeof v.costsSeeded === "number" ? v.costsSeeded : 0,
  };
}

function cleanQty(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return round2(n);
}

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t === "" ? null : t.slice(0, 60);
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "item";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
