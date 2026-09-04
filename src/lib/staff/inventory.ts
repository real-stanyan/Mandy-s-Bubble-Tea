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
  const readings = shopCounts
    .filter((c) => c.counts[itemId] != null && daysBetween(c.date, today) <= windowDays)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

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
};

export type InventoryView = {
  today: string;
  coverDays: number;
  rows: InventoryRow[];
  /** Pickups confirmed today, newest last. */
  todaysPickups: PickupRecord[];
  lastShopCountDate: string | null;
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
    return {
      ...item,
      usage,
      usagePerDay,
      usageSource,
      shop,
      shopCoverDays: cover(shop?.qty ?? null),
      warehouseCoverDays: cover(item.qty),
      low: isLow(item),
      suggestion: suggestPickup(usagePerDay, shop?.qty ?? null, item.qty, state.coverDays),
    };
  });
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
  };
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
      if (q == null || item.qty == null) return item;
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
    updatedAt: now.toISOString(),
  };
  return { state: { ...state, items: [...state.items, item] }, item };
}

export function removeItem(state: InventoryState, id: string): InventoryState {
  return { ...state, items: state.items.filter((i) => i.id !== id) };
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
        updatedAt: typeof i.updatedAt === "string" ? i.updatedAt : "",
      })),
    pickups: Array.isArray(v.pickups) ? v.pickups : [],
    shopCounts: Array.isArray(v.shopCounts) ? v.shopCounts : [],
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
