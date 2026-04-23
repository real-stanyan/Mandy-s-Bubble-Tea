import "server-only";
import type { Square } from "square";
import { squareClient } from "@/lib/square";
import { slugify } from "@/lib/slugs";

// Catalog data layer. Fetches raw Square objects once, then builds
// view-model types that the UI can consume directly. All price amounts
// stay as BigInt here; formatting happens at the render site via
// formatPrice().

export type ItemVariation = {
  id: string;
  name: string;
  priceCents: bigint | null;
};

export type ModifierOption = {
  id: string;
  name: string;
  /** Upcharge amount. null means the modifier is included (no charge). */
  priceCents: bigint | null;
  ordinal: number;
  /** Whether this modifier should be pre-selected by default. */
  onByDefault: boolean;
};

export type ModifierList = {
  id: string;
  name: string;
  /**
   * Normalized selection bounds.
   *   - minSelected: 0 means optional, >0 means required
   *   - maxSelected: null means unlimited
   *
   * These are the modifier list's OWN defaults. Per-item overrides are
   * applied later in getItemDetail() to produce the effective bounds
   * shown to the customer.
   */
  minSelected: number;
  maxSelected: number | null;
  modifiers: ModifierOption[];
};

/**
 * Reference from a MenuItem to a ModifierList, carrying any per-item
 * override values. Use getItemDetail() to get resolved (effective) bounds.
 */
/** Per-item override for a modifier's onByDefault. */
export type ModifierDefaultOverride = {
  modifierId: string;
  onByDefault: boolean | null;
};

export type ItemModifierListRef = {
  id: string;
  minOverride: number | null;
  maxOverride: number | null;
  /** Per-item overrides for individual modifier defaults. */
  modifierOverrides: ModifierDefaultOverride[];
};

export type MenuItem = {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  /** Convenience price for listings — first variation's price. */
  priceCents: bigint | null;
  /** Convenience label for listings — first variation's name. */
  variationLabel: string | null;
  variations: ItemVariation[];
  modifierListRefs: ItemModifierListRef[];
  categoryIds: string[];
};

export type MenuCategory = {
  id: string;
  squareName: string;
  slug: string;
  imageUrl: string | null;
  itemCount: number;
};

export type Menu = {
  categories: MenuCategory[];
  itemsBySlug: Map<string, MenuItem[]>;
  uncategorizedItems: MenuItem[];
  modifierLists: Map<string, ModifierList>;
};

// --- Normalization helpers --------------------------------------------------

function normalizeListMin(
  raw: bigint | null | undefined,
  selectionType: string | null | undefined,
): number {
  if (raw != null) {
    const n = Number(raw);
    if (n >= 0) return n;
  }
  // Fall back to deprecated selectionType if min/max were never set.
  if (selectionType === "SINGLE") return 0; // SINGLE is "pick one", but whether
  return 0; //                 it's required lives on the item override.
}

function normalizeListMax(
  raw: bigint | null | undefined,
  selectionType: string | null | undefined,
): number | null {
  if (raw != null) {
    const n = Number(raw);
    if (n > 0) return n;
    if (n === 0) return null; // explicitly "no maximum"
  }
  if (selectionType === "SINGLE") return 1;
  return null; // MULTIPLE or unset → no upper bound
}

/**
 * Apply a per-item override to a modifier list's default bound.
 * -1 or null means "not set → use list default".
 */
function resolveMin(
  override: number | null,
  listDefault: number,
): number {
  if (override == null || override < 0) return listDefault;
  return override;
}

function resolveMax(
  override: number | null,
  listDefault: number | null,
): number | null {
  if (override == null || override < 0) return listDefault;
  if (override === 0) return null;
  return override;
}

// --- Builders ---------------------------------------------------------------

function buildModifierList(
  raw: Square.CatalogObject.ModifierList,
): ModifierList | null {
  if (!raw.id) return null;
  const data = raw.modifierListData;
  if (!data) return null;

  const modifiers: ModifierOption[] = [];
  for (const m of data.modifiers ?? []) {
    if (m.type !== "MODIFIER" || !m.id) continue;
    const mod = m as Square.CatalogObject.Modifier;
    const md = mod.modifierData;
    if (!md) continue;
    modifiers.push({
      id: mod.id,
      name: md.name ?? "(unnamed)",
      priceCents: md.priceMoney?.amount ?? null,
      ordinal: md.ordinal ?? 0,
      onByDefault: md.onByDefault === true,
    });
  }
  modifiers.sort((a, b) => a.ordinal - b.ordinal);

  return {
    id: raw.id,
    name: data.name ?? "(unnamed)",
    minSelected: normalizeListMin(data.minSelectedModifiers, data.selectionType),
    maxSelected: normalizeListMax(data.maxSelectedModifiers, data.selectionType),
    modifiers,
  };
}

function buildMenuItem(
  raw: Square.CatalogObject.Item,
  imageUrlById: Map<string, string>,
): MenuItem | null {
  if (!raw.id) return null;
  const data = raw.itemData;
  if (!data) return null;

  const variations: ItemVariation[] = [];
  for (const v of data.variations ?? []) {
    if (v.type !== "ITEM_VARIATION" || !v.id) continue;
    const vv = v as Square.CatalogObject.ItemVariation;
    const vd = vv.itemVariationData;
    if (!vd) continue;
    variations.push({
      id: vv.id,
      name: vd.name ?? "(unnamed)",
      priceCents: vd.priceMoney?.amount ?? null,
    });
  }

  const first = variations[0];
  const firstImageId = data.imageIds?.[0] ?? null;

  return {
    id: raw.id,
    name: data.name ?? "(unnamed)",
    description: data.description ?? null,
    imageUrl: firstImageId ? imageUrlById.get(firstImageId) ?? null : null,
    priceCents: first?.priceCents ?? null,
    variationLabel: first?.name ?? null,
    variations,
    modifierListRefs: (data.modifierListInfo ?? [])
      .filter((mli) => mli.enabled !== false)
      .map((mli): ItemModifierListRef | null => {
        if (!mli.modifierListId) return null;
        return {
          id: mli.modifierListId,
          minOverride: mli.minSelectedModifiers ?? null,
          maxOverride: mli.maxSelectedModifiers ?? null,
          modifierOverrides: (mli.modifierOverrides ?? [])
            .filter((o) => o.modifierId != null)
            .map((o) => ({
              modifierId: o.modifierId!,
              onByDefault: o.onByDefault ?? null,
            })),
        };
      })
      .filter((r): r is ItemModifierListRef => r != null),
    categoryIds: (data.categories ?? [])
      .map((c) => c.id)
      .filter((id): id is string => typeof id === "string"),
  };
}

// --- Top-level fetch --------------------------------------------------------

// Module-level cache so concurrent calls during build (17 workers
// pre-rendering static pages) don't each fire 4 Square API requests.
let _menuPromise: Promise<Menu> | null = null;

/**
 * Fetch all ITEM, CATEGORY, MODIFIER_LIST, and IMAGE objects from Square
 * and build a Menu view model. Each list() call paginates transparently.
 * Results are cached in-process to avoid redundant API calls during build.
 */
export async function getMenu(): Promise<Menu> {
  if (_menuPromise) return _menuPromise;
  _menuPromise = _getMenuImpl();
  return _menuPromise;
}

async function _getMenuImpl(): Promise<Menu> {
  const [itemsPage, categoriesPage, modifierListsPage, imagesPage] =
    await Promise.all([
      squareClient.catalog.list({ types: "ITEM" }),
      squareClient.catalog.list({ types: "CATEGORY" }),
      squareClient.catalog.list({ types: "MODIFIER_LIST" }),
      squareClient.catalog.list({ types: "IMAGE" }),
    ]);

  const rawItems: Square.CatalogObject.Item[] = [];
  for await (const obj of itemsPage) {
    if (obj.type === "ITEM") rawItems.push(obj as Square.CatalogObject.Item);
  }

  const rawCategories: Square.CatalogObject.Category[] = [];
  for await (const obj of categoriesPage) {
    if (obj.type === "CATEGORY")
      rawCategories.push(obj as Square.CatalogObject.Category);
  }

  const rawModifierLists: Square.CatalogObject.ModifierList[] = [];
  for await (const obj of modifierListsPage) {
    if (obj.type === "MODIFIER_LIST")
      rawModifierLists.push(obj as Square.CatalogObject.ModifierList);
  }

  // Build image id → url lookup. Square image objects only expose their
  // URL; captions etc. are ignored for now.
  const imageUrlById = new Map<string, string>();
  for await (const obj of imagesPage) {
    if (obj.type !== "IMAGE" || !obj.id) continue;
    const img = obj as Square.CatalogObject.Image;
    const url = img.imageData?.url ?? null;
    if (url) imageUrlById.set(obj.id, url);
  }

  // Categories. Square dashboard sometimes contains multiple categories
  // with the same name (different ids) — collapse them by slug so the
  // menu doesn't render duplicate sections. categoryIdAlias maps every
  // raw id to the canonical id for its slug.
  const categoryById = new Map<string, MenuCategory>();
  const categoryIdBySlug = new Map<string, string>();
  const categoryIdAlias = new Map<string, string>();
  for (const cat of rawCategories) {
    if (!cat.id) continue;
    const name = cat.categoryData?.name ?? "(unnamed)";
    const slug = slugify(name);
    const existingId = categoryIdBySlug.get(slug);
    if (existingId) {
      categoryIdAlias.set(cat.id, existingId);
      continue;
    }
    const firstImageId = cat.categoryData?.imageIds?.[0] ?? null;
    categoryById.set(cat.id, {
      id: cat.id,
      squareName: name,
      slug,
      imageUrl: firstImageId
        ? imageUrlById.get(firstImageId) ?? null
        : null,
      itemCount: 0,
    });
    categoryIdBySlug.set(slug, cat.id);
    categoryIdAlias.set(cat.id, cat.id);
  }

  // Modifier lists.
  const modifierLists = new Map<string, ModifierList>();
  for (const raw of rawModifierLists) {
    const ml = buildModifierList(raw);
    if (ml) modifierLists.set(ml.id, ml);
  }

  // Items.
  const itemsBySlug = new Map<string, MenuItem[]>();
  const uncategorizedItems: MenuItem[] = [];

  for (const raw of rawItems) {
    const item = buildMenuItem(raw, imageUrlById);
    if (!item) continue;

    // Resolve duplicate category ids to canonical, then dedup so an
    // item attached to "CHEESE CREAM (a)" + "CHEESE CREAM (b)" only
    // lands in the cheese-cream bucket once.
    const seenCanonicalIds = new Set<string>();
    let placed = false;
    for (const catId of item.categoryIds) {
      const canonicalId = categoryIdAlias.get(catId) ?? catId;
      if (seenCanonicalIds.has(canonicalId)) continue;
      seenCanonicalIds.add(canonicalId);
      const cat = categoryById.get(canonicalId);
      if (!cat) continue;
      const bucket = itemsBySlug.get(cat.slug) ?? [];
      bucket.push(item);
      itemsBySlug.set(cat.slug, bucket);
      cat.itemCount += 1;
      placed = true;
    }

    if (!placed) uncategorizedItems.push(item);
  }

  for (const bucket of itemsBySlug.values()) {
    bucket.sort((a, b) => a.name.localeCompare(b.name));
  }

  const categories = Array.from(categoryById.values()).sort((a, b) =>
    a.squareName.localeCompare(b.squareName),
  );

  return { categories, itemsBySlug, uncategorizedItems, modifierLists };
}

// --- Lookups ----------------------------------------------------------------

export function getCategoryBySlug(
  menu: Menu,
  slug: string,
): { category: MenuCategory; items: MenuItem[] } | null {
  const category = menu.categories.find((c) => c.slug === slug);
  if (!category) return null;
  return {
    category,
    items: menu.itemsBySlug.get(slug) ?? [],
  };
}

/**
 * Resolve a single item including its modifier lists with per-item
 * overrides applied. Returns null if the category or item is not found.
 */
export function getItemDetail(
  menu: Menu,
  categorySlug: string,
  itemId: string,
): {
  category: MenuCategory;
  item: MenuItem;
  modifierLists: ModifierList[];
} | null {
  const cat = getCategoryBySlug(menu, categorySlug);
  if (!cat) return null;
  const item = cat.items.find((i) => i.id === itemId);
  if (!item) return null;

  const modifierLists: ModifierList[] = [];
  for (const ref of item.modifierListRefs) {
    const base = menu.modifierLists.get(ref.id);
    if (!base) continue;

    // Apply per-item onByDefault overrides to individual modifiers.
    const overrideMap = new Map(
      ref.modifierOverrides.map((o) => [o.modifierId, o.onByDefault]),
    );
    const modifiers = base.modifiers.map((mod) => {
      const override = overrideMap.get(mod.id);
      if (override == null) return mod;
      return { ...mod, onByDefault: override };
    });

    let minSelected = resolveMin(ref.minOverride, base.minSelected);
    let maxSelected = resolveMax(ref.maxOverride, base.maxSelected);

    // TOPPING list: allow up to 3 selections
    if (base.name.toUpperCase() === "TOPPING") {
      maxSelected = 3;
      minSelected = 0;
    }

    modifierLists.push({
      ...base,
      modifiers,
      minSelected,
      maxSelected,
    });
  }

  return { category: cat.category, item, modifierLists };
}
