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
};

/** Minimal shape this module reads off a fetched menu. */
type PricedMenu = {
  itemsBySlug: Map<string, Array<{ variations: ItemVariation[] }>>;
  uncategorizedItems: Array<{ variations: ItemVariation[] }>;
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

  const indexItem = (item: { variations: ItemVariation[] }) => {
    for (const v of item.variations) {
      variationPriceById.set(v.id, v.priceCents ?? 0n);
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
  return { variationPriceById, modifierPriceById };
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
