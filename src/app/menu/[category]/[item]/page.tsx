import Link from "next/link";
import { notFound } from "next/navigation";
import { getMenu, getItemDetail } from "@/lib/catalog";
import { formatPrice } from "@/lib/utils";
import { BRAND } from "@/lib/constants";
import { ItemOrderForm } from "@/components/menu/ItemOrderForm";
import { CartIcon } from "@/components/cart/CartIcon";

// Item detail page — purely display for now. Variation and modifier
// selection will become interactive in a later slice once the cart
// exists.

export const revalidate = 300;

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
      <ItemFrame backHref="/menu" backLabel="Menu" title="Error">
        <div className="rounded-lg border border-red-200 bg-red-50 p-6">
          <p className="font-semibold text-red-800">Could not load menu</p>
          <p className="mt-2 font-mono text-sm text-red-700">{message}</p>
        </div>
      </ItemFrame>
    );
  }

  const detail = getItemDetail(menu, categorySlug, itemId);
  if (!detail) notFound();

  const { category, item, modifierLists } = detail;

  return (
    <ItemFrame
      backHref={`/menu/${category.slug}`}
      backLabel={category.squareName}
      title={item.name}
      subtitle={
        item.priceCents != null ? formatPrice(item.priceCents) : undefined
      }
    >
      {item.imageUrl && (
        <div className="mb-6 overflow-hidden rounded-lg border border-black/10 bg-zinc-50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.imageUrl}
            alt={item.name}
            className="aspect-[4/3] w-full object-cover"
          />
        </div>
      )}

      {item.description && (
        <p className="mb-6 text-sm leading-relaxed text-zinc-600">
          {item.description}
        </p>
      )}

      <ItemOrderForm item={item} modifierLists={modifierLists} />
    </ItemFrame>
  );
}

function ItemFrame({
  backHref,
  backLabel,
  title,
  subtitle,
  children,
}: {
  backHref: string;
  backLabel: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <header
        className="w-full px-6 py-8 text-white"
        style={{ backgroundColor: BRAND.primaryColor }}
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          <div className="flex items-center justify-between">
            <Link
              href={backHref}
              className="text-sm opacity-80 hover:opacity-100"
            >
              ← {backLabel}
            </Link>
            <CartIcon />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          {subtitle && (
            <p className="text-lg font-medium opacity-90">{subtitle}</p>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
        {children}
      </main>
    </div>
  );
}
