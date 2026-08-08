"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { formatPrice } from "@/lib/utils";

export type ProductRowData = {
  id: string;
  name: string;
  imageUrl: string | null;
  priceCents: number | null;
  /** This week's pre-discount price, or null if not currently a special. */
  originalPriceCents: number | null;
  variationLabel: string | null;
  /**
   * Can't be ordered right now. True for a sold-out drink AND for a TOP 10
   * drink whose locked (non-removable) topping is sold out — from the
   * customer's side those are the same wall, and the second one used to be
   * invisible until they tapped in and found a dead button (#101).
   */
  soldOut: boolean;
  /** What to put on the badge, e.g. "Pudding sold out". */
  soldOutLabel: string;
  categorySlug: string;
  defaultVariation: {
    id: string;
    name: string;
    priceCents: number;
  } | null;
};

export function ProductRow({ item }: { item: ProductRowData }) {
  const router = useRouter();

  const showVariationSubtitle =
    item.variationLabel &&
    item.variationLabel.toLowerCase() !== "regular";

  function openItem() {
    if (item.soldOut) return;
    router.push(`/menu/${item.categorySlug}/${item.id}`);
  }

  function openItemFromButton(e: React.MouseEvent) {
    e.stopPropagation();
    openItem();
  }

  return (
    <div
      role="button"
      tabIndex={item.soldOut ? -1 : 0}
      aria-disabled={item.soldOut}
      onClick={openItem}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openItem();
        }
      }}
      className={
        "flex w-full items-center gap-3.5 px-4 py-2.5 text-left outline-none transition active:bg-cream/50 focus-visible:ring-2 focus-visible:ring-brand/60 " +
        (item.soldOut ? "opacity-55 cursor-default" : "cursor-pointer")
      }
    >
      <div className="relative shrink-0 overflow-hidden rounded-tile bg-sage" style={{ width: 76, height: 76 }}>
        {item.imageUrl ? (
          <Image
            src={item.imageUrl}
            alt={item.name}
            fill
            sizes="76px"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-3xl">🧋</div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3
            className="font-serif text-ink"
            style={{
              fontSize: 16,
              lineHeight: "20px",
              letterSpacing: -0.2,
              fontWeight: 500,
            }}
          >
            {item.name}
          </h3>
          {item.soldOut && (
            <span
              className="rounded-full bg-ink2 px-2 py-0.5 text-white"
              style={{ fontSize: 9, letterSpacing: 1.1, fontWeight: 600 }}
            >
              {item.soldOutLabel.toUpperCase()}
            </span>
          )}
        </div>
        {showVariationSubtitle && (
          <p className="text-ink3 mt-0.5" style={{ fontSize: 11 }}>
            {item.variationLabel}
          </p>
        )}
        {item.priceCents != null && (
          <p className="mt-0.5 flex items-baseline gap-1.5">
            {item.originalPriceCents != null &&
              item.originalPriceCents > item.priceCents && (
                <span className="text-ink4 line-through" style={{ fontSize: 12 }}>
                  {formatPrice(item.originalPriceCents)}
                </span>
              )}
            <span
              className={item.originalPriceCents != null ? "text-red-600" : "text-ink2"}
              style={{ fontSize: 14, fontWeight: 600 }}
            >
              {formatPrice(item.priceCents)}
            </span>
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={openItemFromButton}
        disabled={item.soldOut}
        aria-label={`Customize ${item.name}`}
        tabIndex={-1}
        className={
          "relative inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full transition " +
          (item.soldOut
            ? "bg-ink4 cursor-not-allowed"
            : "bg-brand active:scale-90")
        }
      >
        <Plus size={18} className="text-white" />
      </button>
    </div>
  );
}
