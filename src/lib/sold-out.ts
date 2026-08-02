// Which lines of a cart the catalog currently refuses to sell, and how to say
// so to the customer.
//
// Split out of the create route (#101) because the quote needs the same scan.
// Before that, only /api/orders checked: the checkout page priced the cart, showed
// a total, enabled the pay button, and the refusal arrived AFTER the wallet had
// already been tokenized. Sold-out is knowable the moment the cart is priced, so
// that's where the customer should hear about it.
//
// Note this is a different failure from a stale cart (#84): a stale line has no
// catalog entry at all, a sold-out line has one that says "not today". They read
// the same to the customer — "this drink can't be ordered" — but only sold-out
// comes back on its own tomorrow, so the wording differs.

import type { Menu } from "./catalog";

/** Only sold-out ids are in here; a hit means "refuse", a miss means nothing. */
export type SoldOutIndex = {
  variations: Map<string, string>;
  modifiers: Map<string, string>;
};

export type SoldOutLine = {
  variationId: string;
  modifiers: { id: string }[];
};

export type SoldOutScan = {
  /** Customer-facing names, deduped, in the order first encountered. */
  names: string[];
  /** Positions in the cart, so the UI can point at the row rather than the cart. */
  lineIndexes: number[];
};

export function buildSoldOutIndex(menu: Menu): SoldOutIndex {
  const variations = new Map<string, string>();
  const modifiers = new Map<string, string>();

  const addItems = (items: Iterable<Menu["uncategorizedItems"][number]>) => {
    for (const item of items) {
      for (const v of item.variations) {
        if (!v.soldOut) continue;
        variations.set(v.id, `${item.name}${v.name ? ` (${v.name})` : ""}`);
      }
    }
  };
  for (const items of menu.itemsBySlug.values()) addItems(items);
  addItems(menu.uncategorizedItems);

  for (const ml of menu.modifierLists.values()) {
    for (const mod of ml.modifiers) {
      if (mod.soldOut) modifiers.set(mod.id, mod.name);
    }
  }

  return { variations, modifiers };
}

export function scanSoldOut(
  lines: SoldOutLine[],
  index: SoldOutIndex,
): SoldOutScan {
  const names: string[] = [];
  const seen = new Set<string>();
  const lineIndexes: number[] = [];

  lines.forEach((line, i) => {
    let hit = false;
    const variation = index.variations.get(line.variationId);
    if (variation) {
      hit = true;
      if (!seen.has(variation)) {
        seen.add(variation);
        names.push(variation);
      }
    }
    for (const m of line.modifiers) {
      const modifier = index.modifiers.get(m.id);
      if (!modifier) continue;
      hit = true;
      if (!seen.has(modifier)) {
        seen.add(modifier);
        names.push(modifier);
      }
    }
    if (hit) lineIndexes.push(i);
  });

  return { names, lineIndexes };
}

/**
 * What the customer reads.
 *
 * The old wording ended "Please refresh the menu", which fixes nothing — the
 * cart is persisted, so a refreshed menu still leaves the same dead line in it.
 * The only thing that gets the customer moving is removing that drink, so say
 * that instead.
 */
export function soldOutMessage(names: string[]): string {
  const list = names.join(", ");
  return names.length === 1
    ? `${list} just sold out. Remove that drink from your cart and the rest of your order is fine.`
    : `These just sold out: ${list}. Remove those drinks from your cart and the rest of your order is fine.`;
}
