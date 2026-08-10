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

/** Variation price plus every selected modifier's upcharge × its count.
 *
 *  `variation.priceCents ?? 0n` only substitutes for null/undefined, so a
 *  `0n`-priced variation still accrues modifier upcharges — it does NOT
 *  collapse the whole total to zero. This is deliberate, not a refactor
 *  slip: it matches `lineUnitPrice()` in `src/store/cart.ts`, which has
 *  always summed `variationPriceCents + modifiers` with the variation
 *  price already defaulted to `0n`. The pre-refactor inline guard in
 *  ItemOrderForm (`if (!selectedVariation?.priceCents) return 0n`) was
 *  falsy-checked, so it also zeroed the total for `priceCents === 0n`,
 *  not just `null` — the item modal showed $0.00 while the cart showed
 *  the real with-toppings price. Bringing the guard in line with
 *  lineUnitPrice() makes the two surfaces agree. Do not reintroduce the
 *  old all-or-nothing guard. */
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
 *  ItemOrderForm calls this directly. The chatbox proposal card does not —
 *  it can't, buildCartLine needs live catalog objects the client never
 *  receives — so instead validateProposal() (src/lib/chat/validate-proposal.ts)
 *  calls it server-side, toApiProposal() (src/lib/chat/proposal-to-cart.ts)
 *  serializes the result (BigInt -> decimal string, since BigInt can't
 *  cross JSON), and proposalToCartLine() rehydrates it client-side
 *  (string -> BigInt) right before addLine(). The round trip is lossless
 *  by construction — proposalToCartLine.test.ts asserts it — so both
 *  surfaces still end up with identical signatureFor() ids. If they
 *  diverged, the same drink added from chat and from the menu would split
 *  into two cart rows instead of merging. A modifier picked N times is
 *  emitted N times here, which is what cart.ts's lineUnitPrice() sums
 *  over, and what the round trip must preserve. */
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
