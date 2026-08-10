// This week's specials shelf: a virtual, code-defined category (not a real
// Square category) pinned first on /menu. Square holds the CURRENT
// (discounted) price directly — Stan edits it there. This file is the only
// place the ORIGINAL price is remembered, so the UI can show the
// struck-through comparison. Update this list (and ask an agent to redeploy)
// each time the promo rotates.
//
// Keyed by Square item name (case-insensitive), same convention as
// top10-presets.ts. Array order is display order in the shelf.

export const WEEKLY_SPECIALS_CATEGORY_SLUG = "weekly-specials";
export const WEEKLY_SPECIALS_CATEGORY_NAME = "WEEKLY SPECIALS";

export type WeeklySpecial = {
  name: string;
  originalPriceCents: number;
};

// Names must match the Square catalog item name EXACTLY (case-insensitive) —
// a mismatch fails silently (the item just won't show as a special), so
// double-check against Square Dashboard > Items, not the poster copy. E.g.
// the poster says "Grapefruit Green Tea" / "Blueberry Iced Tea" but the real
// catalog names are "Grapefruit Iced Green Tea" / "Blueberry Iced Green Tea".
export const WEEKLY_SPECIALS: WeeklySpecial[] = [
  { name: "Grapefruit Black Tea", originalPriceCents: 620 },
  { name: "Grapefruit Iced Green Tea", originalPriceCents: 620 },
  { name: "Blueberry Iced Green Tea", originalPriceCents: 620 },
  { name: "Honeydew Milk Tea", originalPriceCents: 620 },
  { name: "Blueberry Slushy", originalPriceCents: 620 },
];

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * The original (pre-discount) price for this item, or null if it isn't
 * currently a weekly special. Compare against the item's live Square price
 * before rendering a strikethrough — if Stan hasn't dropped the price yet,
 * or already restored it, there's nothing to show.
 */
export function originalPriceCentsFor(itemName: string): number | null {
  const hit = WEEKLY_SPECIALS.find((s) => norm(s.name) === norm(itemName));
  return hit ? hit.originalPriceCents : null;
}

/** Names in display order, normalized — used to build the virtual shelf. */
export function orderedWeeklySpecialNames(): string[] {
  return WEEKLY_SPECIALS.map((s) => norm(s.name));
}
