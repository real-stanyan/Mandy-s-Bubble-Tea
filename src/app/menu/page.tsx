import Link from "next/link";
import { getMenu, type Menu, type MenuItem } from "@/lib/catalog";
import { BRAND } from "@/lib/constants";
import { formatPrice } from "@/lib/utils";

// Menu landing page — each category shown as a horizontal section
// with up to 3 preview items and a "See More" link to the full
// category page.

export const revalidate = 300;

const PREVIEW_COUNT = 3;

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

export default async function MenuPage() {
  const result = await loadMenu();

  return (
    <div className="flex flex-1 flex-col">
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-8 sm:mb-10">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
            Menu
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Browse our handcrafted drinks.
          </p>
        </div>

        {!result.ok ? (
          <ErrorState message={result.error} />
        ) : result.menu.categories.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-14">
            {result.menu.categories.map((cat) => {
              const items = result.menu.itemsBySlug.get(cat.slug) ?? [];
              if (items.length === 0) return null;
              const preview = items.slice(0, PREVIEW_COUNT);
              const hasMore = items.length > PREVIEW_COUNT;

              return (
                <section key={cat.id}>
                  {/* Category header */}
                  <div className="mb-5 flex items-baseline justify-between">
                    <h2 className="text-xl font-bold tracking-tight text-zinc-900 sm:text-2xl">
                      {cat.squareName}
                    </h2>
                    <Link
                      href={`/menu/${cat.slug}`}
                      className="text-xs font-medium hover:underline sm:text-sm"
                      style={{ color: BRAND.primaryColor }}
                    >
                      {hasMore
                        ? `See all ${items.length} items →`
                        : "See all →"}
                    </Link>
                  </div>

                  {/* Item cards */}
                  <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5">
                    {preview.map((item) => (
                      <li key={item.id}>
                        <ItemCard item={item} categorySlug={cat.slug} />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}

        {result.ok && result.menu.uncategorizedItems.length > 0 && (
          <p className="mt-6 text-xs text-zinc-400">
            {result.menu.uncategorizedItems.length} item(s) without a category
            are hidden.
          </p>
        )}
      </main>
    </div>
  );
}

function ItemCard({
  item,
  categorySlug,
}: {
  item: MenuItem;
  categorySlug: string;
}) {
  return (
    <Link
      href={`/menu/${categorySlug}/${item.id}`}
      className="group block overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm transition hover:shadow-md"
    >
      {/* Image */}
      <div className="aspect-square w-full overflow-hidden">
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.imageUrl}
            alt={item.name}
            className="h-full w-full object-contain transition group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center text-5xl"
            style={{ backgroundColor: BRAND.accentColor }}
          >
            🧋
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3 sm:p-4">
        <h3 className="text-xs font-semibold text-zinc-900 sm:text-sm">{item.name}</h3>
        {item.priceCents != null && (
          <p className="mt-0.5 text-[11px] text-zinc-500 sm:text-xs">
            {formatPrice(item.priceCents)}
          </p>
        )}
        <div className="mt-2 sm:mt-3">
          <span
            className="inline-flex w-full items-center justify-center rounded-full py-1.5 text-[11px] font-semibold text-white transition group-hover:opacity-90 sm:py-2 sm:text-xs"
            style={{ backgroundColor: BRAND.primaryColor }}
          >
            Add to Cart
          </span>
        </div>
      </div>
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-black/20 p-12 text-center">
      <p className="text-zinc-600">No categories found.</p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-6">
      <p className="font-semibold text-red-800">Could not load menu</p>
      <p className="mt-2 font-mono text-sm text-red-700">{message}</p>
    </div>
  );
}
