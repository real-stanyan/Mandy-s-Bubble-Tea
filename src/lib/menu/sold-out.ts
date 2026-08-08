import type { Menu, MenuItem } from "@/lib/catalog";
import { lockedToppingsFor, isLockedToppingName } from "@/lib/menu/top10-presets";

// Shared between /api/orders (create) and /api/orders/quote so a sold-out
// variation or modifier is caught — and explained the same way — before the
// customer reaches payment, not just when the create route rejects it at the
// last step (see #: "Top 10 item can't be added / customer can't pay, no
// explanation" — the quote route used to skip this check entirely).

export type SoldOutCheckLine = {
  variationId: string;
  modifiers: { id: string }[];
};

/**
 * Names of every sold-out variation/modifier referenced by these lines,
 * deduped and in first-seen order.
 */
export function findSoldOutLineNames(
  menu: Menu,
  lines: SoldOutCheckLine[],
): string[] {
  const variationSoldOut = new Map<string, { name: string; soldOut: boolean }>();
  for (const items of menu.itemsBySlug.values()) {
    for (const item of items) {
      for (const v of item.variations) {
        variationSoldOut.set(v.id, {
          name: `${item.name}${v.name ? ` (${v.name})` : ""}`,
          soldOut: v.soldOut,
        });
      }
    }
  }
  for (const item of menu.uncategorizedItems) {
    for (const v of item.variations) {
      variationSoldOut.set(v.id, {
        name: `${item.name}${v.name ? ` (${v.name})` : ""}`,
        soldOut: v.soldOut,
      });
    }
  }

  const modifierSoldOut = new Map<string, { name: string; soldOut: boolean }>();
  for (const ml of menu.modifierLists.values()) {
    for (const mod of ml.modifiers) {
      modifierSoldOut.set(mod.id, { name: mod.name, soldOut: mod.soldOut });
    }
  }

  const soldOutNames: string[] = [];
  for (const line of lines) {
    const v = variationSoldOut.get(line.variationId);
    if (v?.soldOut) soldOutNames.push(v.name);
    for (const m of line.modifiers) {
      const mod = modifierSoldOut.get(m.id);
      if (mod?.soldOut) soldOutNames.push(mod.name);
    }
  }
  return Array.from(new Set(soldOutNames));
}

/**
 * Locked TOP 10 toppings that are sold out for this item, by name.
 *
 * A TOP 10 drink pre-selects its toppings and refuses to let them be removed
 * (that IS the product — "Taro Milk Tea (with Pudding)"). So one sold-out
 * topping makes the whole drink unorderable, and the customer has no way to
 * work around it. The listing pages only ever looked at `item.soldOut`, which
 * is the drink's OWN status and knows nothing about toppings — so the card
 * looked perfectly normal, and the dead end was only discovered after tapping
 * in and finding a disabled button (#101).
 *
 * Empty outside the TOP 10 category: the same drink under its home category
 * has these toppings optional, so a sold-out one just can't be picked.
 */
export function soldOutLockedToppingNames(
  menu: Menu,
  categorySlug: string | undefined,
  item: MenuItem,
): string[] {
  const locked = lockedToppingsFor(categorySlug, item.name);
  if (locked.length === 0) return [];

  const names: string[] = [];
  for (const ref of item.modifierListRefs) {
    const ml = menu.modifierLists.get(ref.id);
    if (!ml) continue;
    for (const mod of ml.modifiers) {
      if (mod.soldOut && isLockedToppingName(mod.name, locked)) names.push(mod.name);
    }
  }
  return Array.from(new Set(names));
}

/**
 * The line a listing card shows instead of a bare "Sold out", so the customer
 * learns which topping is the problem without having to open the drink.
 * Returns null when there is nothing to say.
 */
export function soldOutBadgeLabel(soldOutToppings: string[]): string | null {
  if (soldOutToppings.length === 0) return null;
  if (soldOutToppings.length === 1) return `${soldOutToppings[0]} sold out`;
  if (soldOutToppings.length === 2) {
    return `${soldOutToppings[0]} & ${soldOutToppings[1]} sold out`;
  }
  // Three locked toppings is the real maximum today (Original Milk Tea Trio).
  // Naming all of them on a card that size stops being readable, so count.
  return `${soldOutToppings.length} toppings sold out`;
}
