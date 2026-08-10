import type { ItemVariation, MenuItem, ModifierList } from "@/lib/catalog";
import type { CartLine } from "@/store/cart";
import { lockedModifierIds } from "@/lib/menu/top10-presets";

/** listId -> modifierId -> count. Mirrors ItemOrderForm's local state shape. */
export type CountMap = Record<string, Record<string, number>>;

export type BuildCartLineParams = {
  item: MenuItem;
  /** TOP 10 items render under a preset name; falls back to item.name. */
  displayName?: string | null;
  variation: ItemVariation;
  modifierLists: ModifierList[];
  counts: CountMap;
};

/** Seed the default selection: Square's onByDefault, plus TOP 10 locked
 *  toppings which the customer is not allowed to remove. */
export function buildDefaultCounts(
  modifierLists: ModifierList[],
  lockedToppings: string[] = [],
): CountMap {
  const initial: CountMap = {};
  for (const ml of modifierLists) {
    const defaults = ml.modifiers.filter((m) => m.onByDefault);
    if (defaults.length === 0) continue;
    const map: Record<string, number> = {};
    for (const m of defaults) map[m.id] = 1;
    initial[ml.id] = map;
  }
  for (const { listId, modifierId } of lockedModifierIds(modifierLists, lockedToppings)) {
    const map = initial[listId] ?? {};
    if ((map[modifierId] ?? 0) < 1) map[modifierId] = 1;
    initial[listId] = map;
  }
  return initial;
}

/** Variation price plus every selected modifier's upcharge × its count. */
export function unitPriceCentsFor(
  variation: ItemVariation,
  modifierLists: ModifierList[],
  counts: CountMap,
): bigint {
  let total = variation.priceCents ?? 0n;
  for (const ml of modifierLists) {
    const map = counts[ml.id];
    if (!map) continue;
    for (const mod of ml.modifiers) {
      const count = map[mod.id] ?? 0;
      if (count > 0 && mod.priceCents) total += mod.priceCents * BigInt(count);
    }
  }
  return total;
}

/** The single source of truth for turning a selection into a cart line.
 *  Both the menu's ItemOrderForm and the chatbox proposal card go through
 *  here — if they diverged, the same drink added from chat and from the
 *  menu would produce different signatureFor() ids and split into two
 *  cart rows. A modifier picked N times is emitted N times, which is what
 *  cart.ts's lineUnitPrice() sums over. */
export function buildCartLine(
  params: BuildCartLineParams,
): Omit<CartLine, "id" | "quantity"> {
  const { item, displayName, variation, modifierLists, counts } = params;
  const modifiers = modifierLists.flatMap((ml) => {
    const map = counts[ml.id];
    if (!map) return [];
    return ml.modifiers.flatMap((m) => {
      const count = map[m.id] ?? 0;
      if (count <= 0) return [];
      return Array.from({ length: count }, () => ({
        id: m.id,
        name: m.name,
        priceCents: m.priceCents ?? 0n,
      }));
    });
  });

  return {
    itemId: item.id,
    itemName: displayName ?? item.name,
    itemImageUrl: item.imageUrl,
    variationId: variation.id,
    variationName: variation.name,
    variationPriceCents: variation.priceCents ?? 0n,
    modifiers,
  };
}
