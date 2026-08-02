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
  // Slug of a TOP-10-only product photo. Resolved to a real source by the
  // platform-specific resolver below (a public URL on web, a bundled require
  // on app). When absent, the drink keeps its normal Square catalog image.
  image?: string;
};

type ModifierListLike = { id: string; modifiers: { id: string; name: string }[] };

type SoldOutModifierListLike = {
  modifiers: { name: string; soldOut: boolean }[];
};

const TOP10_PRESETS: Record<string, Top10Preset> = {
  "brown sugar milk tea": {
    lockedToppings: ["Pearls"],
    displayName: "Brown Sugar Milk Tea (with Pearls)",
    image: "brown-sugar-milk-tea",
  },
  "chocolate frappe": {
    lockedToppings: ["Chocolate Popping (New)"],
    displayName: "Chocolate Frappe (with Choc Popping)",
    image: "chocolate-frappe",
  },
  "lychee iced green tea": {
    lockedToppings: ["Lychee Jelly"],
    displayName: "Lychee Iced Green Tea (with Lychee Jelly)",
    image: "lychee-iced-green-tea",
  },
  "mango slushy": {
    lockedToppings: ["Mango Jelly"],
    displayName: "Mango Slushy (with Mango Jelly)",
    image: "mango-slushy",
  },
  "original milk tea": {
    lockedToppings: ["Pearls", "Herbal Jelly", "Pudding"],
    displayName: "Original Milk Tea Trio (Pearl, Grass Jelly & Pudding)",
    image: "original-milk-tea",
  },
  "red dragon fruit slushy": {
    lockedToppings: ["Aloe Vera"],
    displayName: "Red Dragon Fruit Slushy (with Aloe Vera)",
    image: "red-dragon-fruit-slushy",
  },
  "taro milk tea": {
    lockedToppings: ["Pudding"],
    displayName: "Taro Milk Tea (with Pudding)",
    image: "taro-milk-tea",
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

// Total upcharge (in cents) of the locked toppings for this drink inside
// TOP 10 — i.e. how much the curated toppings add on top of the base price.
// 0 outside TOP 10 or for drinks with no preset. `modifiers` is the flattened
// list of the item's available modifiers (name + numeric cents). Shared.
export function lockedToppingsPriceCents(
  categorySlug: string | undefined,
  itemName: string,
  modifiers: { name: string; priceCents: number }[],
): number {
  const locked = lockedToppingsFor(categorySlug, itemName);
  if (locked.length === 0) return 0;
  let sum = 0;
  for (const name of locked) {
    const match = modifiers.find((m) => norm(m.name) === norm(name));
    if (match) sum += match.priceCents;
  }
  return sum;
}

// Slug of the TOP-10-only product photo, or null when this drink has no
// override (or is being viewed outside TOP 10). Shared, platform-agnostic.
export function imageSlugFor(
  categorySlug: string | undefined,
  itemName: string,
): string | null {
  if (categorySlug !== TOP10_CATEGORY_SLUG) return null;
  return getTop10Preset(itemName)?.image ?? null;
}

// Web resolver: full public URL of the override image, or null to fall back
// to the Square catalog image. Files live in /public/image/top10/<slug>.webp.
export function imageUrlFor(
  categorySlug: string | undefined,
  itemName: string,
): string | null {
  const slug = imageSlugFor(categorySlug, itemName);
  return slug ? `/image/top10/${slug}.webp` : null;
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

/**
 * Names of this drink's locked toppings that are currently sold out.
 *
 * A locked topping is pre-selected AND non-removable, so one selling out makes
 * the whole drink unorderable — the customer can't take it off to get past it.
 * Nothing on the listing showed that (the card reads `item.soldOut`, which is
 * the drink's own state and knows nothing about toppings), so the drink looked
 * available right up to a dead Add-to-Cart button with no explanation (#101).
 *
 * Empty outside TOP 10: there the same toppings are optional, and an optional
 * sold-out topping is just an option the customer can't pick.
 */
export function soldOutLockedToppings(
  categorySlug: string | undefined,
  itemName: string,
  modifierLists: SoldOutModifierListLike[],
): string[] {
  const locked = lockedToppingsFor(categorySlug, itemName);
  if (locked.length === 0) return [];
  const out: string[] = [];
  for (const ml of modifierLists) {
    for (const mod of ml.modifiers) {
      if (mod.soldOut && isLockedToppingName(mod.name, locked)) {
        out.push(mod.name);
      }
    }
  }
  return out;
}
