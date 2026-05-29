import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getMenu, getItemDetail } from "@/lib/catalog";
import { formatPrice } from "@/lib/utils";
import { BRAND } from "@/lib/constants";
import { ItemOrderForm } from "@/components/menu/ItemOrderForm";
import { lockedToppingsFor, displayNameFor } from "@/lib/menu/top10-presets";
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
  return {
    title: shownName,
    description:
      item.description ??
      `Order ${shownName} from Mandy's Bubble Tea — pickup at Southport.`,
    openGraph: item.imageUrl ? { images: [{ url: item.imageUrl }] } : undefined,
  };
}

type PageProps = {
  params: Promise<{ category: string; item: string }>;
};

export default async function ItemDetailPage({ params }: PageProps) {
  const { category: categorySlug, item: itemId } = await params;

  let menu;
  try {
    menu = await getMenu();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return (
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <div className="rounded-lg border border-red-200 bg-red-50 p-6">
          <p className="font-semibold text-red-800">Could not load menu</p>
          <p className="mt-2 font-mono text-sm text-red-700">{message}</p>
        </div>
      </main>
    );
  }

  const detail = getItemDetail(menu, categorySlug, itemId);
  if (!detail) notFound();

  const { category, item, modifierLists } = detail;
  const lockedToppings = lockedToppingsFor(category.slug, item.name);
  const shownName = displayNameFor(category.slug, item.name);

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
            <BreadcrumbLink href={`/menu/${category.slug}`}>
              {category.squareName}
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{shownName}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="grid items-start gap-6 sm:gap-10 md:grid-cols-2">
        {/* Left — product image */}
        <div className="relative">
          <div className="overflow-hidden rounded-2xl">
            {item.imageUrl ? (
              <div className="relative aspect-square w-full" style={{ backgroundColor: BRAND.accentColor }}>
                <Image
                  src={item.imageUrl}
                  alt={item.name}
                  fill
                  sizes="(max-width: 768px) 100vw, 50vw"
                  className="object-contain"
                  priority
                />
              </div>
            ) : (
              <div
                className="flex aspect-square w-full items-center justify-center text-7xl"
                style={{ backgroundColor: BRAND.accentColor }}
              >
                🧋
              </div>
            )}
          </div>

          {/* Loyalty badge */}
          <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-xs font-medium shadow-sm backdrop-blur-sm">
            <span>⭐</span>
            <span className="text-zinc-700">
              Earn 1 star with this purchase
            </span>
          </div>
        </div>

        {/* Right — product info + order form */}
        <div>
          {/* Category badge */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span
              className="rounded-full px-3 py-1 text-xs font-semibold text-white"
              style={{ backgroundColor: "#5B7A3A" }}
            >
              {category.squareName}
            </span>
          </div>

          <h1 className="text-2xl font-bold leading-tight tracking-tight text-zinc-900 sm:text-3xl md:text-4xl">
            {shownName}
          </h1>

          {item.description && (
            <p className="mt-3 text-sm leading-relaxed text-zinc-500">
              {item.description}
            </p>
          )}

          {item.priceCents != null && (
            <p className="mt-4 text-2xl font-bold text-zinc-900">
              {formatPrice(item.priceCents)}
            </p>
          )}

          <div className="mt-6">
            <ItemOrderForm
              item={item}
              modifierLists={modifierLists}
              lockedToppings={lockedToppings}
              displayName={shownName}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
