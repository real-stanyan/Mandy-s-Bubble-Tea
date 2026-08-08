import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getMenu, getCategoryBySlug, top10SurchargeCents, type MenuItem } from "@/lib/catalog";
import { formatPrice } from "@/lib/utils";
import { BRAND } from "@/lib/constants";
import { displayNameFor, imageUrlFor } from "@/lib/menu/top10-presets";
import { soldOutBadgeLabel, soldOutLockedToppingNames } from "@/lib/menu/sold-out";
import { originalPriceCentsFor } from "@/lib/menu/weekly-specials";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

// Items within a single category. Unknown slugs 404.
// Data layer fetches the entire menu once and this page filters from it —
// that's fine while the catalog is small; later we can add a
// per-category query to avoid loading everything.

export const revalidate = 10;

export async function generateStaticParams() {
  try {
    const menu = await getMenu();
    return menu.categories.map((c) => ({ category: c.slug }));
  } catch (err) {
    console.error("[menu/[category]] generateStaticParams skipped:", err);
    return [];
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { category: slug } = await params;
  const menu = await getMenu();
  const found = getCategoryBySlug(menu, slug);
  const name = found?.category.squareName ?? "Menu";
  return {
    title: name,
    description: `Browse ${name} drinks at Mandy's Bubble Tea — order online for pickup.`,
  };
}

type PageProps = {
  params: Promise<{ category: string }>;
};

export default async function CategoryPage({ params }: PageProps) {
  const { category: slug } = await params;

  let menu;
  try {
    menu = await getMenu();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return (
      <CategoryFrame
        title="Error"
        subtitle="Could not load menu"
        crumb={<MenuCrumb current="Error" />}
      >
        <div className="rounded-lg border border-red-200 bg-red-50 p-6">
          <p className="font-semibold text-red-800">Could not load menu</p>
          <p className="mt-2 font-mono text-sm text-red-700">{message}</p>
        </div>
      </CategoryFrame>
    );
  }

  const found = getCategoryBySlug(menu, slug);
  if (!found) notFound();

  const { category, items } = found;

  return (
    <CategoryFrame
      title={category.squareName}
      subtitle={`${items.length} ${items.length === 1 ? "item" : "items"}`}
      crumb={<MenuCrumb current={category.squareName} />}
    >
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-black/20 p-12 text-center">
          <p className="text-zinc-600">No items in this category yet.</p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          {items.map((item) => {
            // A TOP 10 drink whose locked topping is sold out can't be ordered
            // either — the topping is part of the product and can't be removed.
            // Blocking the tap here is the point: the card used to look normal
            // and the dead end only showed up as a disabled button (#101).
            const blockedToppings = soldOutLockedToppingNames(menu, category.slug, item);
            const unorderable = item.soldOut || blockedToppings.length > 0;
            const card = (
              <ItemCard
                item={item}
                displayName={displayNameFor(category.slug, item.name)}
                imageUrl={imageUrlFor(category.slug, item.name)}
                unorderable={unorderable}
                badgeLabel={soldOutBadgeLabel(blockedToppings) ?? "Sold out"}
                priceCents={
                  item.priceCents == null
                    ? null
                    : item.priceCents + top10SurchargeCents(menu, category.slug, item)
                }
              />
            );
            return (
              <li key={item.id}>
                {unorderable ? (
                  <div aria-disabled="true" className="block cursor-not-allowed">
                    {card}
                  </div>
                ) : (
                  <Link href={`/menu/${category.slug}/${item.id}`} className="block">
                    {card}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </CategoryFrame>
  );
}

function CategoryFrame({
  title,
  subtitle,
  crumb,
  children,
}: {
  title: string;
  subtitle: string;
  crumb: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-5 sm:mb-6">
        {crumb}
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">
          {title}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>
      </div>
      {children}
    </main>
  );
}

function MenuCrumb({ current }: { current: string }) {
  return (
    <Breadcrumb>
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
          <BreadcrumbPage>{current}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function ItemCard({
  item,
  displayName,
  imageUrl,
  priceCents,
  unorderable = item.soldOut,
  badgeLabel = "Sold out",
}: {
  item: MenuItem;
  displayName?: string;
  imageUrl?: string | null;
  priceCents?: bigint | null;
  /** The drink itself may be fine and still be unbuyable — see the caller. */
  unorderable?: boolean;
  /** Names the actual blocker, e.g. "Pudding sold out". */
  badgeLabel?: string;
}) {
  const shownImage = imageUrl ?? item.imageUrl;
  const shownPrice = priceCents !== undefined ? priceCents : item.priceCents;
  const originalPriceCents = originalPriceCentsFor(item.name);
  const isOnSpecial =
    originalPriceCents != null &&
    shownPrice != null &&
    BigInt(originalPriceCents) > shownPrice;
  return (
    <div
      className={`relative overflow-hidden rounded-lg border border-black/10 bg-white shadow-sm transition hover:shadow-md ${
        unorderable ? "opacity-50" : ""
      }`}
    >
      {unorderable && (
        <span className="absolute right-2 top-2 z-10 rounded-full bg-zinc-900/85 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white">
          {badgeLabel}
        </span>
      )}
      {shownImage ? (
        <div className="relative aspect-square w-full">
          <Image
            src={shownImage}
            alt={displayName ?? item.name}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 250px"
            className={`object-cover ${unorderable ? "grayscale" : ""}`}
          />
        </div>
      ) : (
        <div
          className="flex aspect-square w-full items-center justify-center bg-zinc-100 text-xs text-zinc-400"
        >
          No image
        </div>
      )}
      <div className="p-3 sm:p-4">
        <h2 className="text-sm font-semibold text-zinc-900 sm:text-lg">{displayName ?? item.name}</h2>
        {item.variationLabel && (
          <p className="mt-0.5 text-[10px] uppercase tracking-wide text-zinc-500 sm:mt-1 sm:text-xs">
            {item.variationLabel}
          </p>
        )}
        <p className="mt-1 flex flex-wrap items-baseline gap-1.5 sm:mt-2">
          {isOnSpecial && (
            <span className="text-xs text-zinc-400 line-through sm:text-sm">
              {formatPrice(originalPriceCents)}
            </span>
          )}
          <span
            className="text-base font-semibold sm:text-xl"
            style={{ color: isOnSpecial ? "#dc2626" : BRAND.primaryColor }}
          >
            {shownPrice != null ? formatPrice(shownPrice) : "—"}
          </span>
        </p>
      </div>
    </div>
  );
}
