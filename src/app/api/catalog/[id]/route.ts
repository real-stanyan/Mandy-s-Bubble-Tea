import { NextResponse } from "next/server";
import {
  getMenu,
  isCheeseCreamItem,
  sortModifierLists,
} from "@/lib/catalog";
import { serializeSquareResponse } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const menu = await getMenu();

    // Find the item across all categories
    let foundItem = null;
    for (const [, items] of menu.itemsBySlug) {
      const item = items.find((i) => i.id === id);
      if (item) {
        foundItem = item;
        break;
      }
    }
    if (!foundItem) {
      // Check uncategorized
      foundItem = menu.uncategorizedItems.find((i) => i.id === id) ?? null;
    }

    if (!foundItem) {
      return NextResponse.json(
        { ok: false, error: "Item not found" },
        { status: 404 },
      );
    }

    // Resolve modifier lists with per-item overrides
    const banBrulee = isCheeseCreamItem(foundItem, menu);
    const modifierLists = foundItem.modifierListRefs
      .map((ref) => {
        const base = menu.modifierLists.get(ref.id);
        if (!base) return null;

        const overrideMap = new Map(
          ref.modifierOverrides.map((o) => [o.modifierId, o.onByDefault]),
        );
        const modifiers = base.modifiers
          .filter((mod) => !(banBrulee && /brul[eé]+/i.test(mod.name)))
          .map((mod) => {
            const override = overrideMap.get(mod.id);
            if (override == null) return mod;
            return { ...mod, onByDefault: override };
          });

        let minSelected =
          ref.minOverride != null && ref.minOverride >= 0
            ? ref.minOverride
            : base.minSelected;
        let maxSelected =
          ref.maxOverride != null && ref.maxOverride >= 0
            ? ref.maxOverride === 0
              ? null
              : ref.maxOverride
            : base.maxSelected;

        // TOPPING list: allow up to 3 selections
        if (base.name.toUpperCase() === "TOPPING") {
          maxSelected = 3;
          minSelected = 0;
        }

        return {
          ...base,
          modifiers,
          minSelected,
          maxSelected,
        };
      })
      .filter((ml) => ml != null);

    const sortedModifierLists = sortModifierLists(modifierLists);

    const item = {
      id: foundItem.id,
      type: "ITEM",
      imageUrl: foundItem.imageUrl,
      soldOut: foundItem.soldOut,
      itemData: {
        name: foundItem.name,
        description: foundItem.description,
        categories: foundItem.categoryIds.map((catId) => {
          const cat = menu.categories.find((c) => c.id === catId);
          return { id: catId, name: cat?.squareName ?? "" };
        }),
        variations: foundItem.variations.map((v) => ({
          id: v.id,
          soldOut: v.soldOut,
          itemVariationData: {
            name: v.name,
            priceMoney:
              v.priceCents != null
                ? { amount: v.priceCents, currency: "AUD" }
                : undefined,
          },
        })),
      },
    };

    return NextResponse.json(
      serializeSquareResponse({
        ok: true,
        item,
        modifierLists: sortedModifierLists,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
