import { describe, expect, it } from "vitest";
import type { ItemVariation, ModifierList } from "@/lib/catalog";
import {
  authoritativeSubtotalCents,
  authoritativeUnitPrice,
  authoritativeUnitPrices,
  buildAuthoritativePriceMaps,
} from "@/lib/order-pricing";

/**
 * Security regression suite for P1/P2 (client price tampering).
 *
 * The order route attaches the welcome/IG FIXED_AMOUNT discount and the
 * delivery/service fees based on per-cup prices. Before this fix those prices
 * came straight from the client body (`variationPriceCents`/`priceCents`), so a
 * forged price inflated the discount (→ free cart) or faked the free-delivery
 * subtotal threshold. These helpers must derive every price from the Square
 * catalog menu, never the client.
 */

function variation(id: string, priceCents: bigint | null): ItemVariation {
  return { id, name: id, priceCents, soldOut: false };
}

function menuOf(
  variations: ItemVariation[],
  modifiers: Array<{ id: string; priceCents: bigint | null }>,
) {
  const ml: ModifierList = {
    id: "ml1",
    name: "Toppings",
    // Only id + priceCents are read by the builder; cast the rest.
    modifiers: modifiers.map((m) => ({
      id: m.id,
      name: m.id,
      priceCents: m.priceCents,
      soldOut: false,
    })) as ModifierList["modifiers"],
  } as ModifierList;
  return {
    itemsBySlug: new Map([["milky", [{ variations }]]]),
    uncategorizedItems: [] as Array<{ variations: ItemVariation[] }>,
    modifierLists: new Map([["ml1", ml]]),
  };
}

describe("buildAuthoritativePriceMaps", () => {
  it("indexes variation + modifier prices from the catalog menu", () => {
    const maps = buildAuthoritativePriceMaps(
      menuOf([variation("v1", 600n)], [{ id: "m1", priceCents: 80n }]),
    );
    expect(maps.variationPriceById.get("v1")).toBe(600n);
    expect(maps.modifierPriceById.get("m1")).toBe(80n);
  });

  it("treats a null catalog price as 0", () => {
    const maps = buildAuthoritativePriceMaps(
      menuOf([variation("v1", null)], [{ id: "m1", priceCents: null }]),
    );
    expect(maps.variationPriceById.get("v1")).toBe(0n);
    expect(maps.modifierPriceById.get("m1")).toBe(0n);
  });

  it("indexes uncategorized items too", () => {
    const base = menuOf([], []);
    base.uncategorizedItems.push({ variations: [variation("vU", 550n)] });
    const maps = buildAuthoritativePriceMaps(base);
    expect(maps.variationPriceById.get("vU")).toBe(550n);
  });
});

describe("authoritativeUnitPrice — ignores the client-sent price (P1/P2 fix)", () => {
  const maps = buildAuthoritativePriceMaps(
    menuOf([variation("v1", 600n)], [{ id: "m1", priceCents: 80n }]),
  );

  it("uses the catalog price even when the client forges a huge price", () => {
    // Attack: client claims a $6 drink is $9999 to inflate the 30% discount.
    const unit = authoritativeUnitPrice(
      { variationId: "v1", modifiers: [{ id: "m1" }], quantity: 1 },
      maps,
    );
    expect(unit).toBe(680n); // 600 + 80, NOT 999900-derived
  });

  it("contributes 0 for an unknown variation id (never the client price)", () => {
    const unit = authoritativeUnitPrice(
      { variationId: "ghost", modifiers: [], quantity: 1 },
      maps,
    );
    expect(unit).toBe(0n);
  });

  it("contributes 0 for an unknown modifier id", () => {
    const unit = authoritativeUnitPrice(
      { variationId: "v1", modifiers: [{ id: "ghost" }], quantity: 1 },
      maps,
    );
    expect(unit).toBe(600n);
  });
});

describe("authoritativeUnitPrices — expanded per quantity", () => {
  it("repeats the unit price per cup for promo picking", () => {
    const maps = buildAuthoritativePriceMaps(
      menuOf([variation("v1", 600n), variation("v2", 700n)], []),
    );
    const prices = authoritativeUnitPrices(
      [
        { variationId: "v1", modifiers: [], quantity: 2 },
        { variationId: "v2", modifiers: [], quantity: 1 },
      ],
      maps,
    );
    expect(prices).toEqual([600n, 600n, 700n]);
  });
});

describe("authoritativeSubtotalCents", () => {
  const maps = buildAuthoritativePriceMaps(
    menuOf([variation("v1", 600n)], [{ id: "m1", priceCents: 80n }]),
  );

  it("sums authoritative unit prices × quantity", () => {
    const subtotal = authoritativeSubtotalCents(
      [{ variationId: "v1", modifiers: [{ id: "m1" }], quantity: 3 }],
      maps,
    );
    expect(subtotal).toBe(2040n); // (600 + 80) * 3
  });

  it("a forged client price cannot lift the subtotal over a free-delivery threshold", () => {
    // The attacker's inflated price is irrelevant: subtotal is catalog-derived.
    const subtotal = authoritativeSubtotalCents(
      [{ variationId: "v1", modifiers: [], quantity: 1 }],
      maps,
    );
    expect(subtotal).toBe(600n);
  });
});
