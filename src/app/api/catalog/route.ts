import { NextResponse } from "next/server";
import { getMenu } from "@/lib/catalog";
import { serializeSquareResponse } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const menu = await getMenu();

    // Flatten all items across categories for the app
    const allItems: Record<string, unknown>[] = [];
    const seenIds = new Set<string>();

    for (const [, items] of menu.itemsBySlug) {
      for (const item of items) {
        if (seenIds.has(item.id)) continue;
        seenIds.add(item.id);
        allItems.push({
          id: item.id,
          type: "ITEM",
          imageUrl: item.imageUrl,
          soldOut: item.soldOut,
          itemData: {
            name: item.name,
            description: item.description,
            categories: item.categoryIds.map((catId) => {
              const cat = menu.categories.find((c) => c.id === catId);
              return { id: catId, name: cat?.squareName ?? "" };
            }),
            variations: item.variations.map((v) => ({
              id: v.id,
              soldOut: v.soldOut,
              itemVariationData: {
                name: v.name,
                priceMoney: v.priceCents != null
                  ? { amount: v.priceCents, currency: "AUD" }
                  : undefined,
              },
            })),
          },
        });
      }
    }

    // Also include uncategorized items
    for (const item of menu.uncategorizedItems) {
      if (seenIds.has(item.id)) continue;
      seenIds.add(item.id);
      allItems.push({
        id: item.id,
        type: "ITEM",
        imageUrl: item.imageUrl,
        soldOut: item.soldOut,
        itemData: {
          name: item.name,
          description: item.description,
          categories: [],
          variations: item.variations.map((v) => ({
            id: v.id,
            soldOut: v.soldOut,
            itemVariationData: {
              name: v.name,
              priceMoney: v.priceCents != null
                ? { amount: v.priceCents, currency: "AUD" }
                : undefined,
            },
          })),
        },
      });
    }

    const categories = menu.categories.map((c) => ({
      id: c.id,
      name: c.squareName,
    }));

    return NextResponse.json(
      serializeSquareResponse({
        ok: true,
        items: allItems,
        categories,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
