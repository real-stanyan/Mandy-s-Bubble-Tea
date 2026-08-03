import type { Menu } from "@/lib/catalog";

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
