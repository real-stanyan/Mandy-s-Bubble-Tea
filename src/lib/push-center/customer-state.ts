// Push Center — one row per Square customer, folded from their COMPLETED
// orders, so an audience can be built in one table scan instead of paging
// every order Square holds. Pure: the Square scan and the upsert live in
// customer-state.server.ts / the backfill script.

export type Channel = "pos" | "web" | "app" | "other";

/** What the scan hands the fold — one per Square order. */
export type OrderFact = {
  id: string;
  customerId: string;
  /** ISO, as Square reports created_at. */
  createdAt: string;
  channel: Channel;
  items: Array<{ name: string; qty: number }>;
};

export type RecentOrder = { id: string; at: string; ch: Channel };

export type CustomerStateRow = {
  customer_id: string;
  first_order_at: string | null;
  last_order_at: string | null;
  last_channel: Channel | null;
  order_count: number;
  /** Last RECENT_KEEP orders, oldest first. Dedupes re-scans and gives the gap median. */
  recent_orders: RecentOrder[];
  /** Cups by item name, top ITEMS_KEEP kept. */
  item_counts: Record<string, number>;
  /** Orders placed 17:00 or later, shop time. */
  evening_orders: number;
  updated_at: string;
};

export const RECENT_KEEP = 30;
export const ITEMS_KEEP = 12;
const DAY = 86_400_000;

export function emptyState(customerId: string): CustomerStateRow {
  return {
    customer_id: customerId,
    first_order_at: null,
    last_order_at: null,
    last_channel: null,
    order_count: 0,
    recent_orders: [],
    item_counts: {},
    evening_orders: 0,
    updated_at: new Date(0).toISOString(),
  };
}

/** Hour of day in Brisbane (UTC+10, no daylight saving). */
export function brisbaneHour(iso: string): number {
  const t = Date.parse(iso);
  return Math.floor(((t / 3_600_000) % 24 + 24 + 10) % 24);
}

/**
 * Fold orders into a state row. Idempotent over overlapping scans: an order
 * whose id is already in recent_orders is skipped, so a refresh that re-reads
 * the last ten minutes does not count anyone twice. (An order older than the
 * RECENT_KEEP window cannot be re-fed — the scan only moves forward.)
 */
export function foldOrders(existing: CustomerStateRow | null, orders: OrderFact[], now: Date): CustomerStateRow {
  if (orders.length === 0 && existing) return existing;
  const base = existing ?? emptyState(orders[0].customerId);
  const seen = new Set(base.recent_orders.map((o) => o.id));
  const recent = [...base.recent_orders];
  const items = { ...base.item_counts };
  let count = base.order_count;
  let evening = base.evening_orders;
  let first = base.first_order_at ? Date.parse(base.first_order_at) : null;
  let last = base.last_order_at ? Date.parse(base.last_order_at) : null;
  let lastCh = base.last_channel;

  const sorted = [...orders].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  for (const o of sorted) {
    if (seen.has(o.id)) continue;
    seen.add(o.id);
    const t = Date.parse(o.createdAt);
    if (!Number.isFinite(t)) continue;
    count++;
    if (brisbaneHour(o.createdAt) >= 17) evening++;
    if (first === null || t < first) first = t;
    if (last === null || t >= last) {
      last = t;
      lastCh = o.channel;
    }
    recent.push({ id: o.id, at: o.createdAt, ch: o.channel });
    for (const it of o.items) {
      const name = it.name.trim();
      if (!name) continue;
      items[name] = (items[name] ?? 0) + (Number.isFinite(it.qty) && it.qty > 0 ? it.qty : 1);
    }
  }

  recent.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const trimmedRecent = recent.slice(-RECENT_KEEP);
  const trimmedItems = Object.fromEntries(
    Object.entries(items)
      .sort((a, b) => b[1] - a[1])
      .slice(0, ITEMS_KEEP),
  );

  return {
    customer_id: base.customer_id,
    first_order_at: first === null ? null : new Date(first).toISOString(),
    last_order_at: last === null ? null : new Date(last).toISOString(),
    last_channel: lastCh,
    order_count: count,
    recent_orders: trimmedRecent,
    item_counts: trimmedItems,
    evening_orders: evening,
    updated_at: now.toISOString(),
  };
}

export function daysSince(iso: string, now: Date): number {
  return (now.getTime() - Date.parse(iso)) / DAY;
}

/** Median days between consecutive recent orders; null under two orders. */
export function medianGapDays(state: CustomerStateRow): number | null {
  const ts = state.recent_orders.map((o) => Date.parse(o.at)).filter(Number.isFinite).sort((a, b) => a - b);
  if (ts.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < ts.length; i++) gaps.push((ts[i] - ts[i - 1]) / DAY);
  gaps.sort((a, b) => a - b);
  const m = Math.floor(gaps.length / 2);
  return gaps.length % 2 ? gaps[m] : (gaps[m - 1] + gaps[m]) / 2;
}

/** The drink they order most; null when nothing is on record. */
export function favouriteItem(state: CustomerStateRow): string | null {
  let best: string | null = null;
  let n = 0;
  for (const [name, c] of Object.entries(state.item_counts)) {
    if (c > n) {
      n = c;
      best = name;
    }
  }
  return best;
}

/**
 * Group a scan's orders by customer. Orders without a customer are POS
 * walk-ins nobody can push to, and are dropped here rather than everywhere.
 */
export function groupByCustomer(orders: OrderFact[]): Map<string, OrderFact[]> {
  const m = new Map<string, OrderFact[]>();
  for (const o of orders) {
    if (!o.customerId) continue;
    const list = m.get(o.customerId);
    if (list) list.push(o);
    else m.set(o.customerId, [o]);
  }
  return m;
}
