import { TOP10_CATEGORY_SLUG, isTop10DisplayName } from "@/lib/menu/top10-presets";
import { WEEKLY_SPECIALS_CATEGORY_SLUG } from "@/lib/menu/weekly-specials";

/** The slice of the menu this needs. Structural on purpose, so the rule can
 *  be unit-tested without the server-only catalog module. */
export type MenuShelves = {
  categories: { slug: string }[];
  itemsBySlug: Map<string, { id: string }[]>;
};

/**
 * Which category to reopen a cart line under when the customer edits it from
 * checkout. The cart stores the drink, not where it was picked from, and the
 * category matters: inside TOP 10 the same drink carries locked toppings and
 * a display name. A line wearing a TOP 10 display name goes back to TOP 10;
 * anything else goes to the drink's home category — never the weekly-specials
 * shelf, which only mirrors drinks that live elsewhere. null when the catalog
 * no longer has the item at all.
 */
export function editCategorySlugFor(
  menu: MenuShelves,
  itemId: string,
  lineName: string | null | undefined,
): string | null {
  const homes = menu.categories
    .filter((c) => (menu.itemsBySlug.get(c.slug) ?? []).some((i) => i.id === itemId))
    .map((c) => c.slug);
  if (homes.length === 0) return null;
  if (lineName && isTop10DisplayName(lineName) && homes.includes(TOP10_CATEGORY_SLUG)) {
    return TOP10_CATEGORY_SLUG;
  }
  return (
    homes.find((s) => s !== TOP10_CATEGORY_SLUG && s !== WEEKLY_SPECIALS_CATEGORY_SLUG) ??
    homes.find((s) => s !== TOP10_CATEGORY_SLUG) ??
    homes[0]
  );
}
