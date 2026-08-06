// The daily stock-check list.
//
// This file is the single source of truth for what staff count and when an
// item is flagged. Editing it is how the list changes — there is deliberately
// no admin UI for it, because the list changes a few times a year and a
// wrong threshold silently under-orders for weeks.
//
// Two kinds of rule, because the shop treats two kinds of stock differently:
//
//   * `threshold` — the everyday case. Flagged for reorder when the counted
//     quantity is AT OR BELOW the number (`<=`, not `<`: "1" means one left
//     already needs reordering, since the next delivery isn't same-day).
//
//   * `weekly` — slow movers where a daily reorder prompt is noise. These are
//     never flagged on quantity; instead the remaining count is reported on
//     Tuesdays (the shop's ordering day) so it can go on that week's order.
//
// Quantities are in whatever unit staff count in — bottles, boxes, bags. They
// are deliberately not normalised, because the number on the shelf is what
// staff can actually verify. Fractions are real (herbal jelly 0.3, watermelon
// 0.5) and are why quantity is a float, not an int.

export type AlertRule =
  | { kind: "threshold"; value: number }
  | { kind: "weekly" };

export type StockItem = {
  /** Stable id — used as the form field name and the history key, so it must
   *  not change when the display name is reworded. */
  id: string;
  name: string;
  rule: AlertRule;
};

export type StockCategory = {
  id: string;
  name: string;
  items: StockItem[];
};

const t = (value: number): AlertRule => ({ kind: "threshold", value });
const weekly: AlertRule = { kind: "weekly" };

export const STOCK_LIST: StockCategory[] = [
  {
    id: "syrup",
    name: "Syrup",
    items: [
      { id: "syrup-mango", name: "Mango", rule: t(1) },
      { id: "syrup-peach", name: "Peach", rule: t(1) },
      { id: "syrup-lychee", name: "Lychee", rule: t(1) },
      { id: "syrup-strawberry", name: "Strawberry", rule: t(1) },
      { id: "syrup-pf", name: "PF", rule: t(1) },
      { id: "syrup-grape", name: "Grape", rule: t(1) },
      { id: "syrup-ga", name: "GA", rule: t(1) },
      { id: "syrup-pa", name: "PA", rule: t(1) },
      { id: "syrup-gf", name: "GF", rule: t(1) },
      { id: "syrup-lemon", name: "Lemon", rule: t(1) },
      { id: "syrup-lymt", name: "LYMT", rule: t(1) },
      { id: "syrup-blueberry", name: "Blueberry", rule: t(1) },
      { id: "syrup-guava", name: "Guava", rule: t(1) },
      { id: "syrup-yogurt", name: "Yogurt", rule: t(1) },
      { id: "syrup-honeydew", name: "Honeydew", rule: t(1) },
      { id: "syrup-orange", name: "Orange", rule: t(1) },
      { id: "syrup-brown-sugar", name: "Brown Sugar", rule: t(1) },
      { id: "syrup-tiger-brown-sugar", name: "Tiger Brown Sugar", rule: t(1) },
      { id: "syrup-strawberry-jam", name: "Strawberry Jam", rule: t(1) },
      { id: "syrup-honey", name: "Honey", rule: weekly },
      { id: "syrup-fructose", name: "Fructose", rule: weekly },
    ],
  },
  {
    id: "topping",
    name: "Topping",
    items: [
      { id: "topping-lychee-jelly", name: "Lychee Jelly", rule: t(1) },
      { id: "topping-mango-jelly", name: "Mango Jelly", rule: t(1) },
      { id: "topping-aloe-vera", name: "Aloe Vera", rule: t(1) },
      { id: "topping-rainbow", name: "Rainbow", rule: t(1) },
      { id: "topping-strawberry-popping", name: "Strawberry Popping Ball", rule: t(1) },
      { id: "topping-jellyball", name: "Jellyball", rule: t(3) },
      { id: "topping-grape-jelly", name: "Grape Jelly", rule: weekly },
      { id: "topping-coffee-jelly", name: "Coffee Jelly", rule: weekly },
      { id: "topping-herbal-jelly", name: "Herbal Jelly", rule: t(0.3) },
      { id: "topping-green-apple-popping", name: "Green Apple Popping", rule: t(1) },
      { id: "topping-oat-popping", name: "Oat Popping", rule: t(1) },
      { id: "topping-chocolate-popping", name: "Chocolate Popping", rule: t(1) },
    ],
  },
  {
    id: "powder",
    name: "Powder",
    items: [
      { id: "powder-matcha", name: "Matcha", rule: t(1) },
      { id: "powder-coconut", name: "Coconut", rule: t(1) },
      { id: "powder-silver-taro", name: "Silver Taro", rule: t(1) },
      { id: "powder-colorful-taro", name: "Colorful Taro", rule: t(1) },
      { id: "powder-thai", name: "Thai", rule: t(1) },
      { id: "powder-cheese", name: "Cheese Powder", rule: weekly },
      { id: "powder-chocolate", name: "Chocolate", rule: weekly },
    ],
  },
  {
    id: "tea",
    name: "Tea",
    items: [
      { id: "tea-black", name: "Black Tea", rule: weekly },
      { id: "tea-green", name: "Green Tea", rule: t(2) },
      { id: "tea-oolong", name: "Oolong", rule: weekly },
      { id: "tea-earl-grey", name: "Earl Grey", rule: weekly },
    ],
  },
  {
    id: "others",
    name: "Others",
    items: [
      { id: "other-fresh-milk", name: "Fresh Milk", rule: t(5) },
      { id: "other-oat-milk", name: "Oat Milk", rule: t(3) },
      { id: "other-soy-milk", name: "Soy Milk", rule: t(3) },
      { id: "other-almond-milk", name: "Almond Milk", rule: t(3) },
      { id: "other-cream", name: "Cream", rule: t(4) },
      { id: "other-condensed-milk", name: "Condensed Milk", rule: t(6) },
      { id: "other-ice-cream", name: "Ice Cream", rule: t(2) },
      { id: "other-raw-sugar", name: "Raw Sugar", rule: t(2) },
      { id: "other-orange", name: "Orange", rule: t(1) },
      { id: "other-grapefruit", name: "Grapefruit", rule: t(1) },
      { id: "other-lemon", name: "Lemon", rule: t(1) },
      { id: "other-lime", name: "Lime", rule: t(1) },
      { id: "other-watermelon", name: "Watermelon", rule: t(0.5) },
      { id: "other-banana", name: "Banana", rule: t(8) },
      { id: "other-oreo", name: "Oreo", rule: t(5) },
      { id: "other-pf-seeds", name: "PF Seeds", rule: t(10) },
      { id: "other-grapefruit-sacs", name: "Grapefruit Sacs", rule: weekly },
      { id: "other-tissue", name: "Tissue", rule: t(5) },
      { id: "other-black-garbage-bag", name: "Black Garbage Bag", rule: t(2) },
    ],
  },
];

export const ALL_ITEMS: StockItem[] = STOCK_LIST.flatMap((c) => c.items);

export function findItem(id: string): StockItem | undefined {
  return ALL_ITEMS.find((i) => i.id === id);
}

// The shop orders on Tuesdays, in Queensland. Evaluating "is it Tuesday" in
// UTC would flip the weekly items on at 10am Monday local time and off again
// at 10am Tuesday, so the weekday has to be read in the shop's own timezone.
export const SHOP_TIMEZONE = "Australia/Brisbane";

export function isOrderDay(now: Date = new Date()): boolean {
  const weekday = new Intl.DateTimeFormat("en-AU", {
    timeZone: SHOP_TIMEZONE,
    weekday: "short",
  }).format(now);
  return weekday === "Tue";
}

/**
 * Is this item due to be counted today?
 *
 * Weekly items are the shop's slow movers, and counting them daily was work
 * with no reader: their numbers were collected every day and only ever acted
 * on once a week. So they are now due on Tuesdays only — mandatory then,
 * genuinely optional the rest of the week.
 *
 * This is what separates "nobody counted it" from "nobody had to". Before, a
 * Wednesday report listed every weekly item under NOT COUNTED, which trained
 * staff to read that section as noise — and that is the section that exists to
 * catch a shelf someone actually skipped.
 */
export function isDueToday(item: StockItem, now: Date = new Date()): boolean {
  return item.rule.kind !== "weekly" || isOrderDay(now);
}

export type Counted = { item: StockItem; qty: number | null };

export type StockReport = {
  /** Below or at threshold — needs reordering today. */
  reorder: Array<{ item: StockItem; qty: number; threshold: number }>;
  /** Weekly items, reported with their remaining quantity on order day. */
  weekly: Array<{ item: StockItem; qty: number }>;
  /** Counted but fine — kept so the email can show the full picture. */
  ok: Array<{ item: StockItem; qty: number }>;
  /** Left blank by staff. Surfaced rather than silently treated as zero. */
  missing: StockItem[];
  /**
   * Weekly items left blank on a non-Tuesday — not due, so not a gap. Kept as
   * its own bucket rather than dropped so the report can still say what was
   * skipped by design, and so `missing` stays a list of real omissions.
   */
  notDue: StockItem[];
  isOrderDay: boolean;
};

/**
 * Turn a set of counts into the report that drives both the on-screen result
 * and the email.
 *
 * A blank entry is NOT zero. Zero means "we have none, order it"; blank means
 * "nobody looked". Collapsing the two would either invent an urgent reorder
 * or hide a shelf nobody checked, so blanks get their own bucket.
 */
export function buildReport(counts: Counted[], now: Date = new Date()): StockReport {
  const orderDay = isOrderDay(now);
  const report: StockReport = {
    reorder: [],
    weekly: [],
    ok: [],
    missing: [],
    notDue: [],
    isOrderDay: orderDay,
  };

  for (const { item, qty } of counts) {
    if (qty == null || Number.isNaN(qty)) {
      // A weekly item blank on a non-Tuesday was never asked for, so calling
      // it "not counted" would be reporting an omission that did not happen.
      if (!isDueToday(item, now)) report.notDue.push(item);
      else report.missing.push(item);
      continue;
    }
    if (item.rule.kind === "weekly") {
      // Only surfaced on order day — that is the whole point of the rule.
      if (orderDay) report.weekly.push({ item, qty });
      else report.ok.push({ item, qty });
      continue;
    }
    if (qty <= item.rule.value) {
      report.reorder.push({ item, qty, threshold: item.rule.value });
    } else {
      report.ok.push({ item, qty });
    }
  }

  return report;
}
