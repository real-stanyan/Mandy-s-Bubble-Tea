import Link from "next/link";
import { notFound } from "next/navigation";
import { getMenu, getCategoryBySlug, type MenuItem } from "@/lib/catalog";
import { formatPrice } from "@/lib/utils";
import { BRAND } from "@/lib/constants";
import { CartIcon } from "@/components/cart/CartIcon";

// Items within a single category. Unknown slugs 404.
// Data layer fetches the entire menu once and this page filters from it —
// that's fine while the catalog is small; later we can add a
// per-category query to avoid loading everything.

export const revalidate = 300;

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
      <CategoryFrame title="Error" subtitle="Could not load menu">
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
    >
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-black/20 p-12 text-center">
          <p className="text-zinc-600">No items in this category yet.</p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={`/menu/${category.slug}/${item.id}`}
                className="block"
              >
                <ItemCard item={item} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </CategoryFrame>
  );
}

function CategoryFrame({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <header
        className="w-full px-6 py-8 text-white"
        style={{ backgroundColor: BRAND.primaryColor }}
      >
        <div className="mx-auto flex max-w-5xl flex-col gap-2">
          <div className="flex items-center justify-between">
            <Link
              href="/menu"
              className="text-sm opacity-80 hover:opacity-100"
            >
              ← Menu
            </Link>
            <CartIcon />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm opacity-90">{subtitle}</p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        {children}
      </main>
    </div>
  );
}

function ItemCard({ item }: { item: MenuItem }) {
  return (
    <div className="overflow-hidden rounded-lg border border-black/10 bg-white shadow-sm transition hover:shadow-md">
      {item.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.imageUrl}
          alt={item.name}
          className="aspect-square w-full object-cover"
          loading="lazy"
        />
      ) : (
        <div
          className="flex aspect-square w-full items-center justify-center bg-zinc-100 text-xs text-zinc-400"
        >
          No image
        </div>
      )}
      <div className="p-4">
        <h2 className="text-lg font-semibold text-zinc-900">{item.name}</h2>
        {item.variationLabel && (
          <p className="mt-1 text-xs uppercase tracking-wide text-zinc-500">
            {item.variationLabel}
          </p>
        )}
        <p
          className="mt-2 text-xl font-semibold"
          style={{ color: BRAND.primaryColor }}
        >
          {item.priceCents != null ? formatPrice(item.priceCents) : "—"}
        </p>
      </div>
    </div>
  );
}
