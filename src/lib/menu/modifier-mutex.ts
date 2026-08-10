import type { ModifierList, ModifierOption } from "@/lib/catalog";
import type { CountMap } from "@/lib/menu/build-cart-line";

// Cross-modifier exclusivity rules the shop enforces physically, not just
// as a Square catalog constraint:
//   - Warm ice ⊥ Cheese Cream / Brulee toppings — hot drinks don't pair
//     with cold cream or torched sugar.
//   - Cheese Cream ⊥ Brulee — mutually exclusive partners within a list,
//     each still stackable on its own.
//
// Extracted verbatim from ItemOrderForm.tsx's canIncrement()/
// getExclusivePartner() so the menu UI and the chatbox validator enforce
// the exact same rule from one place instead of two copies drifting apart.

export const EXCLUSIVE_TOPPINGS = ["Cheese Cream", "Brulee"];
export const WARM_ICE_NAME = "warm";

export function isExclusiveModifier(mod: ModifierOption): boolean {
  return EXCLUSIVE_TOPPINGS.includes(mod.name);
}

export function isWarmIceModifier(mod: ModifierOption): boolean {
  return mod.name.trim().toLowerCase() === WARM_ICE_NAME;
}

export function someSelectedAcrossLists(
  counts: CountMap,
  modifierLists: ModifierList[],
  predicate: (mod: ModifierOption) => boolean,
): boolean {
  for (const ml of modifierLists) {
    const map = counts[ml.id];
    if (!map) continue;
    for (const mod of ml.modifiers) {
      if ((map[mod.id] ?? 0) > 0 && predicate(mod)) return true;
    }
  }
  return false;
}

export function getExclusivePartner(
  list: ModifierList,
  modifierId: string,
): string | null {
  const mod = list.modifiers.find((m) => m.id === modifierId);
  if (!mod || !isExclusiveModifier(mod)) return null;
  const partner = list.modifiers.find(
    (m) => m.id !== modifierId && isExclusiveModifier(m),
  );
  return partner?.id ?? null;
}
