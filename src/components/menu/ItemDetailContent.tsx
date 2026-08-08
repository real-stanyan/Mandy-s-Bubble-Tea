import Image from "next/image";
import { Star } from "lucide-react";
import { getMenu, getItemDetail, top10SurchargeCents } from "@/lib/catalog";
import { formatPrice } from "@/lib/utils";
import { ItemOrderForm } from "@/components/menu/ItemOrderForm";
import {
  lockedToppingsFor,
  displayNameFor,
  imageUrlFor,
} from "@/lib/menu/top10-presets";
import { originalPriceCentsFor } from "@/lib/menu/weekly-specials";

// Shared item-detail body, used by both the full route page
// (menu/[category]/[item]) and the intercepting modal (@modal/(.)…). Loads
// the item from Square and renders the image + info + order form. The page
// wraps it in <main> + breadcrumb; the modal wraps it in a dialog card.

type Props = {
  categorySlug: string;
  itemId: string;
  inModal?: boolean;
};

export async function ItemDetailContent({
  categorySlug,
  itemId,
  inModal = false,
}: Props) {
  let menu;
  try {
    menu = await getMenu();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return (
      <div className="rounded-card border border-line bg-card p-6">
        <p className="font-semibold text-ink">Could not load this drink</p>
        <p className="mt-2 font-mono text-sm text-ink3">{message}</p>
      </div>
    );
  }

  const detail = getItemDetail(menu, categorySlug, itemId);
  if (!detail) {
    return (
      <div className="rounded-card border border-line bg-card p-10 text-center">
        <p className="text-[15px] font-semibold text-ink">Drink not found</p>
        <p className="mt-1 text-[13.5px] text-ink3">
          This item may no longer be on the menu.
        </p>
      </div>
    );
  }

  const { category, item, modifierLists } = detail;
  const lockedToppings = lockedToppingsFor(category.slug, item.name);
  const shownName = displayNameFor(category.slug, item.name);
  const heroImage = imageUrlFor(category.slug, item.name) ?? item.imageUrl;
  // Inside TOP 10 the locked toppings are mandatory, so the headline price
  // shows the real starting price (base + locked toppings).
  const displayPriceCents =
    item.priceCents == null
      ? null
      : item.priceCents + top10SurchargeCents(menu, category.slug, item);
  const originalPriceCents = originalPriceCentsFor(item.name);
  const isOnSpecial =
    originalPriceCents != null &&
    displayPriceCents != null &&
    originalPriceCents > displayPriceCents;

  return (
    <div
      className={
        inModal
          ? "grid items-stretch md:grid-cols-2"
          : "grid items-start gap-6 sm:gap-10 md:grid-cols-2"
      }
    >
      {/* Left — product image */}
      <div className="relative">
        <div
          className={
            "relative aspect-square w-full overflow-hidden bg-bg2 " +
            (inModal ? "md:h-full md:aspect-auto" : "rounded-card")
          }
        >
          {heroImage ? (
            <Image
              src={heroImage}
              alt={shownName}
              fill
              sizes="(max-width: 768px) 100vw, 50vw"
              className="object-contain"
              priority
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-7xl">
              🧋
            </div>
          )}
        </div>

        {/* Loyalty badge */}
        <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-card/90 px-3 py-1.5 text-xs font-medium shadow-sm backdrop-blur-sm">
          <Star size={13} className="text-star" />
          <span className="text-ink2">Earn 1 star with this purchase</span>
        </div>
      </div>

      {/* Right — product info + order form */}
      <div className={inModal ? "p-6 sm:p-7" : ""}>
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.13em] text-brand">
          {category.squareName}
        </p>

        <h1 className="mt-2 font-serif text-[clamp(26px,3.4vw,34px)] font-semibold leading-[1.05] tracking-[-0.02em] text-ink">
          {shownName}
        </h1>

        {item.description && (
          <p className="mt-2.5 text-[14.5px] leading-relaxed text-ink2">
            {item.description}
          </p>
        )}

        {displayPriceCents != null && (
          <div className="mt-3 flex items-baseline gap-2.5">
            {isOnSpecial && (
              <span className="text-[16px] font-semibold text-ink4 line-through">
                {formatPrice(originalPriceCents)}
              </span>
            )}
            <p
              className={
                "text-[22px] font-bold " + (isOnSpecial ? "text-red-600" : "text-brand")
              }
            >
              {formatPrice(displayPriceCents)}
            </p>
          </div>
        )}

        <div className="mt-6">
          <ItemOrderForm
            item={item}
            modifierLists={modifierLists}
            lockedToppings={lockedToppings}
            displayName={shownName}
            stickyPreview={inModal}
          />
        </div>
      </div>
    </div>
  );
}
