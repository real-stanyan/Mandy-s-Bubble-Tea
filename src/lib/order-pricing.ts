import type { ItemVariation, ModifierList } from "@/lib/catalog";

/**
 * Server-authoritative order pricing.
 *
 * SECURITY: every price here comes from the Square catalog menu, never from the
 * client request body. The order route attaches the welcome/IG FIXED_AMOUNT
 * discount and the delivery/service fee amounts from these values; if they were
 * client-controlled (as they were before this module) a forged
 * `variationPriceCents`/`priceCents` could inflate the discount into a free cart
 * or fake the free-delivery subtotal threshold. Any id not present in the
 * catalog contributes 0 — we NEVER fall back to the client price, so a forged
 * value can only ever shrink a discount/subtotal, never inflate one.
 */

export type AuthoritativePriceMaps = {
  variationPriceById: Map<string, bigint>;
  modifierPriceById: Map<string, bigint>;
  /**
   * Catalog item name each variation belongs to.
   *
   * Prices alone can't answer "is this cup the promo drink?" — the tasting
   * promo is authored against a product NAME (see tasting-promo.ts), and the
   * cart only ever carries variation ids. Same authoritative-catalog rule as
   * the prices: the client's idea of what it ordered is never consulted.
   */
  itemNameByVariationId: Map<string, string>;
};

/** Minimal shape this module reads off a fetched menu. */
type PricedItem = { name: string; variations: ItemVariation[] };

type PricedMenu = {
  itemsBySlug: Map<string, PricedItem[]>;
  uncategorizedItems: PricedItem[];
  modifierLists: Map<string, ModifierList>;
};

/** Minimal shape this module reads off a client order line. */
type PricingLine = {
  variationId: string;
  modifiers: Array<{ id: string }>;
  quantity: number;
};

export function buildAuthoritativePriceMaps(
  menu: PricedMenu,
): AuthoritativePriceMaps {
  const variationPriceById = new Map<string, bigint>();
  const modifierPriceById = new Map<string, bigint>();
  const itemNameByVariationId = new Map<string, string>();

  const indexItem = (item: PricedItem) => {
    for (const v of item.variations) {
      variationPriceById.set(v.id, v.priceCents ?? 0n);
      itemNameByVariationId.set(v.id, item.name);
    }
  };
  for (const items of menu.itemsBySlug.values()) {
    for (const item of items) indexItem(item);
  }
  for (const item of menu.uncategorizedItems) indexItem(item);
  for (const ml of menu.modifierLists.values()) {
    for (const m of ml.modifiers) {
      modifierPriceById.set(m.id, m.priceCents ?? 0n);
    }
  }
  return { variationPriceById, modifierPriceById, itemNameByVariationId };
}

/** Authoritative price (cents) for one cup = variation + its modifiers. */
export function authoritativeUnitPrice(
  line: PricingLine,
  maps: AuthoritativePriceMaps,
): bigint {
  const base = maps.variationPriceById.get(line.variationId) ?? 0n;
  const mods = line.modifiers.reduce(
    (sum, m) => sum + (maps.modifierPriceById.get(m.id) ?? 0n),
    0n,
  );
  return base + mods;
}

/**
 * Variation ids in `lines` that this catalog snapshot has never heard of.
 *
 * `authoritativeUnitPrice` prices those at 0 on purpose — see the module note:
 * falling back to the client's number would let a forged `variationPriceCents`
 * inflate a percentage discount. That is the right call when the answer is a
 * DISCOUNT (0 only ever shrinks it), and the wrong one when the answer is a
 * TOTAL the customer reads: a stale cart line then prices the whole order at
 * A$0.00, which reads as "this is free".
 *
 * So the quote route asks this first and declines to answer rather than quoting
 * a number it cannot stand behind. Reachable in production without any forgery:
 * an item deleted and re-added in Square gets a new id, while the old one sits
 * in a persisted cart indefinitely.
 */
/**
 * What both the quote and the create route tell a customer whose cart holds a
 * line the catalog dropped. One string because they must not disagree: the
 * quote's copy is what the summary shows, and the create route's is what a
 * client too old to have that UI falls back to displaying.
 */
export const STALE_CART_MESSAGE =
  "Some items in your cart are no longer on the menu. Remove them and add them again.";

export function unknownVariationIds(
  lines: PricingLine[],
  maps: AuthoritativePriceMaps,
): string[] {
  const unknown = new Set<string>();
  for (const line of lines) {
    if (!maps.variationPriceById.has(line.variationId)) {
      unknown.add(line.variationId);
    }
  }
  return [...unknown];
}

/** Per-cup authoritative prices, expanded by quantity (for promo-cup picking). */
export function authoritativeUnitPrices(
  lines: PricingLine[],
  maps: AuthoritativePriceMaps,
): bigint[] {
  const out: bigint[] = [];
  for (const line of lines) {
    const unit = authoritativeUnitPrice(line, maps);
    const qty = Math.max(1, Math.floor(line.quantity));
    for (let i = 0; i < qty; i++) out.push(unit);
  }
  return out;
}

/**
 * Per-cup authoritative record, expanded by quantity: what the cup costs with
 * its toppings, what the drink alone costs, and which catalog item it is.
 *
 * The item-level promos need all three at once — the name to know whether the
 * cup qualifies, the base price to size a per-drink discount, and the full
 * unit price to rank cups against the loyalty-reward picks. A cup whose
 * variation the catalog has never heard of gets an empty name and prices at 0,
 * the same deliberately-shrinking fallback as authoritativeUnitPrice.
 */
export function authoritativeCups(
  lines: PricingLine[],
  maps: AuthoritativePriceMaps,
): Array<{ unitPriceCents: bigint; basePriceCents: bigint; itemName: string }> {
  const out: Array<{
    unitPriceCents: bigint;
    basePriceCents: bigint;
    itemName: string;
  }> = [];
  for (const line of lines) {
    const cup = {
      unitPriceCents: authoritativeUnitPrice(line, maps),
      basePriceCents: maps.variationPriceById.get(line.variationId) ?? 0n,
      itemName: maps.itemNameByVariationId.get(line.variationId) ?? "",
    };
    const qty = Math.max(1, Math.floor(line.quantity));
    for (let i = 0; i < qty; i++) out.push({ ...cup });
  }
  return out;
}

/** Authoritative drinks subtotal (cents). */
export function authoritativeSubtotalCents(
  lines: PricingLine[],
  maps: AuthoritativePriceMaps,
): bigint {
  return lines.reduce(
    (sum, line) =>
      sum +
      authoritativeUnitPrice(line, maps) *
        BigInt(Math.max(1, Math.floor(line.quantity))),
    0n,
  );
}
