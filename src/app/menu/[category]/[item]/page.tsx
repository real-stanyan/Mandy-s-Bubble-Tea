import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getMenu, getItemDetail } from "@/lib/catalog";
import { ItemDetailContent } from "@/components/menu/ItemDetailContent";
import { displayNameFor, imageUrlFor } from "@/lib/menu/top10-presets";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

// Sold-out state on toppings (modifier locationOverrides) must be live —
// ISR was serving stale "Sold out" labels until the next regeneration cycle.
// getMenu() has its own 5s in-process cache, so concurrent requests are deduped.
export const dynamic = "force-dynamic";

export async function generateStaticParams() {
  // Square API blips at build time used to fail the whole Vercel deploy.
  // Returning [] degrades gracefully — pages still render on first request
  // (revalidate = 10 caches them after) instead of breaking the deploy.
  try {
    const menu = await getMenu();
    const params: { category: string; item: string }[] = [];
    for (const cat of menu.categories) {
      const items = menu.itemsBySlug.get(cat.slug) ?? [];
      for (const item of items) {
        params.push({ category: cat.slug, item: item.id });
      }
    }
    return params;
  } catch (err) {
    console.error("[menu/[category]/[item]] generateStaticParams skipped:", err);
    return [];
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { category: categorySlug, item: itemId } = await params;
  const menu = await getMenu();
  const detail = getItemDetail(menu, categorySlug, itemId);
  if (!detail) return { title: "Not Found" };
  const { item } = detail;
  // Match the visible H1: inside TOP 10 the item may be display-renamed.
  const shownName = displayNameFor(detail.category.slug, item.name);
  const ogImage = imageUrlFor(detail.category.slug, item.name) ?? item.imageUrl;
  return {
    title: shownName,
    description:
      item.description ??
      `Order ${shownName} from Mandy's Bubble Tea — pickup at Southport.`,
    openGraph: ogImage ? { images: [{ url: ogImage }] } : undefined,
  };
}

type PageProps = {
  params: Promise<{ category: string; item: string }>;
};

export default async function ItemDetailPage({ params }: PageProps) {
  const { category: categorySlug, item: itemId } = await params;

  // Resolve the category name for the breadcrumb + 404 on unknown items.
  // getMenu() is cached for 5s, so ItemDetailContent re-reads it for free.
  let menu;
  try {
    menu = await getMenu();
  } catch {
    menu = null;
  }
  const detail = menu ? getItemDetail(menu, categorySlug, itemId) : null;
  if (menu && !detail) notFound();

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
      <Breadcrumb className="mb-4 sm:mb-6">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/">Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink href="/menu">Menu</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink href={`/menu/${categorySlug}`}>
              {detail?.category.squareName ?? "Menu"}
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>
              {detail
                ? displayNameFor(detail.category.slug, detail.item.name)
                : "Drink"}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <ItemDetailContent categorySlug={categorySlug} itemId={itemId} />
    </main>
  );
}
