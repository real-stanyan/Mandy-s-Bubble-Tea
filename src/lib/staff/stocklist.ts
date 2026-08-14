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

//   * `sufficiency` — stock nobody counts, because counting it is absurd.
//     Nobody tallies 1,400 cups; they look at the stack and know whether it
//     lasts the day. Forcing a number here would get a made-up one, and a
//     made-up number is worse than an honest "maybe" — it reads as a fact.
//     Answered as enough / maybe / not enough, and "not enough" is the only
//     state that means order today.

export type AlertRule =
  | { kind: "threshold"; value: number }
  | { kind: "weekly" }
  | { kind: "sufficiency" };

/** The three answers a sufficiency item accepts. Stored as these strings all
 *  the way through — form field, POST body, history — so a reader of any of
 *  them sees the answer rather than a code. */
export type Sufficiency = "enough" | "maybe" | "short";

export const SUFFICIENCY_LABEL: Record<Sufficiency, string> = {
  enough: "Enough for today",
  maybe: "Maybe",
  short: "Not enough",
};

/** The three buttons, defined once. The list and the keypad walk both render
 *  them, and two copies would drift — the walk shipped showing a number pad
 *  for cups because it only knew about the other two rule kinds. */
export const SUFFICIENCY_CHOICES: Array<{
  key: Sufficiency;
  label: string;
  tone: string;
}> = [
  {
    key: "enough",
    label: "Enough",
    tone: "border-green-500 bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200",
  },
  {
    key: "maybe",
    label: "Maybe",
    tone: "border-orange-500 bg-orange-50 text-orange-800 dark:bg-orange-950 dark:text-orange-200",
  },
  {
    key: "short",
    label: "Not enough",
    tone: "border-red-500 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200",
  },
];

/** The caption under an item's name, for whichever rule it carries. Returns
 *  the sufficiency wording rather than falling through to "weekly", which is
 *  what the keypad was showing for Cups. */
export function ruleHint(item: StockItem, isOrderDay: boolean): string {
  if (item.rule.kind === "threshold") return `reorder at ${item.rule.value}`;
  if (item.rule.kind === "sufficiency") return "enough for today?";
  return isOrderDay ? "weekly — due today" : "weekly — Tuesdays only";
}

export function isSufficiency(value: string): value is Sufficiency {
  return value === "enough" || value === "maybe" || value === "short";
}

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
const sufficiency: AlertRule = { kind: "sufficiency" };

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
      { id: "powder-brulee", name: "Brûlée Powder", rule: t(1) },
      { id: "powder-pudding", name: "Pudding Powder", rule: t(1) },
    ],
  },
  {
    id: "tea",
    name: "Tea",
    items: [
      { id: "tea-black", name: "Black Tea", rule: weekly },
      { id: "tea-black-fannings", name: "Black Tea Fannings", rule: t(1) },
      { id: "tea-green", name: "Green Tea", rule: t(2) },
      { id: "tea-oolong", name: "Oolong", rule: weekly },
      { id: "tea-earl-grey", name: "Earl Grey", rule: weekly },
    ],
  },
  {
    // Counted by eye, not by number — see the `sufficiency` rule above.
    id: "packaging",
    name: "Packaging",
    items: [
      { id: "packaging-cups", name: "Cups", rule: sufficiency },
      { id: "packaging-straws", name: "Straws", rule: sufficiency },
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

/** A reorder threshold changed from the default in this file, with who
 *  changed it and when. Keyed by item id. */
export type ThresholdOverrides = Record<
  string,
  { value: number; by: string | null; at: string | null }
>;

/**
 * The list as the shop actually uses it: defaults from this file, with any
 * edited thresholds applied over the top.
 *
 * Pure, and returns a new list rather than mutating STOCK_LIST — the defaults
 * have to stay reachable so the UI can show what a number was before someone
 * changed it, and so a bad override is one delete away from the original
 * rather than lost.
 *
 * Only `threshold` items can be overridden. A number on a weekly or
 * sufficiency item would be meaningless — neither compares a count against
 * one — so an override naming them is ignored rather than half-applied.
 */
export function applyThresholds(
  overrides: ThresholdOverrides,
  list: StockCategory[] = STOCK_LIST,
): StockCategory[] {
  return list.map((cat) => ({
    ...cat,
    items: cat.items.map((item) => {
      const o = overrides[item.id];
      if (!o || item.rule.kind !== "threshold") return item;
      return { ...item, rule: { kind: "threshold", value: o.value } };
    }),
  }));
}

/** The default for an item, whatever the current override says. Used by the
 *  editor to show what a changed number used to be. */
export function defaultThreshold(id: string): number | null {
  const item = ALL_ITEMS.find((i) => i.id === id);
  return item && item.rule.kind === "threshold" ? item.rule.value : null;
}

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

export type Counted = {
  item: StockItem;
  /** Numeric items. Null means nobody counted. */
  qty: number | null;
  /** Sufficiency items. Null means nobody answered. */
  level?: Sufficiency | null;
};

export type StockReport = {
  /** Below or at threshold — needs reordering today. */
  reorder: Array<{ item: StockItem; qty: number; threshold: number }>;
  /** Weekly items, reported with their remaining quantity on order day. */
  weekly: Array<{ item: StockItem; qty: number }>;
  /** Counted but fine — kept so the email can show the full picture. */
  ok: Array<{ item: StockItem; qty: number }>;
  /**
   * Sufficiency items, all of them, in urgency order: short, then maybe,
   * then enough. One bucket rather than splitting across `reorder` and `ok`
   * because those two carry quantities and a threshold, and there is no
   * honest number to put there — inventing one is the thing the rule exists
   * to avoid.
   */
  sufficiency: Array<{ item: StockItem; level: Sufficiency }>;
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
    sufficiency: [],
    missing: [],
    notDue: [],
    isOrderDay: orderDay,
  };

  for (const { item, qty, level } of counts) {
    if (item.rule.kind === "sufficiency") {
      // Blank is still a real omission here — these are due every day, and
      // "nobody looked at the cups" is exactly what the report is for.
      if (level == null) report.missing.push(item);
      else report.sufficiency.push({ item, level });
      continue;
    }
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

  // Worst first, so whoever opens the email on a phone sees "not enough"
  // without scrolling — the whole reason these are asked every day.
  const order: Record<Sufficiency, number> = { short: 0, maybe: 1, enough: 2 };
  report.sufficiency.sort((a, b) => order[a.level] - order[b.level]);

  return report;
}

/** Sufficiency items that mean "order today". `maybe` counts: the answer
 *  exists so staff can flag a stack they are unsure about, and treating
 *  unsure as fine would make it a synonym for enough. */
export function sufficiencyNeedingAction(
  report: StockReport,
): Array<{ item: StockItem; level: Sufficiency }> {
  return report.sufficiency.filter((s) => s.level !== "enough");
}
