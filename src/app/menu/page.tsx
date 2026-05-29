import type { Metadata } from "next";
import { getMenu, type Menu } from "@/lib/catalog";
import { displayNameFor, imageUrlFor } from "@/lib/menu/top10-presets";
import {
  MenuBrowser,
  type MenuBrowserSection,
} from "@/components/menu/MenuBrowser";
import type { ProductRowData } from "@/components/menu/ProductRow";

export const metadata: Metadata = {
  title: "Menu",
  description:
    "Browse our full menu — milky teas, fruity teas, fresh brews, frozen drinks and more at Mandy's Bubble Tea.",
};

export const revalidate = 10;

async function loadMenu(): Promise<
  { ok: true; menu: Menu } | { ok: false; error: string }
> {
  try {
    const menu = await getMenu();
    return { ok: true, menu };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

function toSections(menu: Menu): MenuBrowserSection[] {
  const out: MenuBrowserSection[] = [];
  for (const cat of menu.categories) {
    const items = menu.itemsBySlug.get(cat.slug) ?? [];
    if (items.length === 0) continue;
    const rows: ProductRowData[] = items.map((item) => {
      const firstVariation = item.variations[0] ?? null;
      return {
        id: item.id,
        name: displayNameFor(cat.slug, item.name),
        imageUrl: imageUrlFor(cat.slug, item.name) ?? item.imageUrl,
        priceCents: item.priceCents == null ? null : Number(item.priceCents),
        variationLabel: item.variationLabel,
        soldOut: item.soldOut,
        categorySlug: cat.slug,
        defaultVariation: firstVariation
          ? {
              id: firstVariation.id,
              name: firstVariation.name,
              priceCents: Number(firstVariation.priceCents ?? 0n),
            }
          : null,
      };
    });
    out.push({ slug: cat.slug, squareName: cat.squareName, items: rows });
  }
  return out;
}

export default async function MenuPage() {
  const result = await loadMenu();

  return (
    <div className="flex flex-1 flex-col">
      <main className="mx-auto w-full max-w-6xl flex-1">
        {!result.ok ? (
          <ErrorState message={result.error} />
        ) : result.menu.categories.length === 0 ? (
          <EmptyState />
        ) : (
          <MenuBrowser sections={toSections(result.menu)} />
        )}
      </main>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mx-4 mt-10 rounded-card border border-dashed border-line p-10 text-center text-ink3">
      No categories found.
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="mx-4 mt-10 rounded-card border border-red-200 bg-red-50 p-5">
      <p className="font-semibold text-red-800">Could not load menu</p>
      <p className="mt-2 font-mono text-sm text-red-700">{message}</p>
    </div>
  );
}
