// Curated TOP 10 menu: specific toppings are pre-selected and locked
// (non-removable) ONLY when the drink is viewed inside the TOP 10 category.
// The same drink under its home category stays fully optional. Locked
// toppings are charged at normal Square price. One item gets a display-only
// rename (Square/POS/print receipts keep the real catalog name).
//
// Keyed by Square item name (case-insensitive), consistent with the
// name-based CATEGORY_DISPLAY_ORDER matching in src/lib/catalog.ts. Topping
// names below were verified byte-for-byte against the PRODUCTION catalog on
// 2026-05-29; a Square rename would make the matching topping a safe no-op.

export const TOP10_CATEGORY_SLUG = "top-10";

export type Top10Preset = {
  lockedToppings: string[];
  displayName?: string;
};

type ModifierListLike = { id: string; modifiers: { id: string; name: string }[] };

const TOP10_PRESETS: Record<string, Top10Preset> = {
  "brown sugar milk tea": {
    lockedToppings: ["Pearls"],
    displayName: "Brown Sugar Milk Tea (with Pearls)",
  },
  "chocolate frappe": {
    lockedToppings: ["Chocolate Popping (New)"],
    displayName: "Chocolate Frappe (with Choc Popping)",
  },
  "lychee iced green tea": {
    lockedToppings: ["Lychee Jelly"],
    displayName: "Lychee Iced Green Tea (with Lychee Jelly)",
  },
  "mango slushy": {
    lockedToppings: ["Mango Jelly"],
    displayName: "Mango Slushy (with Mango Jelly)",
  },
  "original milk tea": {
    lockedToppings: ["Pearls", "Herbal Jelly", "Pudding"],
    displayName: "Original Milk Tea Trio (Pearl, Grass Jelly & Pudding)",
  },
  "red dragon fruit slushy": {
    lockedToppings: ["Aloe Vera"],
    displayName: "Red Dragon Fruit Slushy (with Aloe Vera)",
  },
  "taro milk tea": {
    lockedToppings: ["Pudding"],
    displayName: "Taro Milk Tea (with Pudding)",
  },
};

function norm(s: string): string {
  return s.trim().toLowerCase();
}

export function getTop10Preset(itemName: string): Top10Preset | undefined {
  return TOP10_PRESETS[norm(itemName)];
}

export function lockedToppingsFor(
  categorySlug: string | undefined,
  itemName: string,
): string[] {
  if (categorySlug !== TOP10_CATEGORY_SLUG) return [];
  return getTop10Preset(itemName)?.lockedToppings ?? [];
}

export function displayNameFor(
  categorySlug: string | undefined,
  itemName: string,
): string {
  if (categorySlug !== TOP10_CATEGORY_SLUG) return itemName;
  return getTop10Preset(itemName)?.displayName ?? itemName;
}

export function isLockedToppingName(
  modifierName: string,
  lockedToppings: string[],
): boolean {
  const target = norm(modifierName);
  return lockedToppings.some((t) => norm(t) === target);
}

export function lockedModifierIds(
  modifierLists: ModifierListLike[],
  lockedToppings: string[],
): { listId: string; modifierId: string }[] {
  if (lockedToppings.length === 0) return [];
  const out: { listId: string; modifierId: string }[] = [];
  for (const ml of modifierLists) {
    for (const mod of ml.modifiers) {
      if (isLockedToppingName(mod.name, lockedToppings)) {
        out.push({ listId: ml.id, modifierId: mod.id });
      }
    }
  }
  return out;
}
