"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { formatPrice } from "@/lib/utils";
import type { ProductRowData } from "@/components/menu/ProductRow";

export function ProductCard({ item }: { item: ProductRowData }) {
  const router = useRouter();

  const showVariationSubtitle =
    item.variationLabel && item.variationLabel.toLowerCase() !== "regular";

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
        "group relative flex flex-col overflow-hidden rounded-card border border-line bg-paper shadow-card outline-none transition focus-visible:ring-2 focus-visible:ring-brand/60 " +
        (item.soldOut
          ? "opacity-55 cursor-default"
          : "cursor-pointer hover:-translate-y-0.5 hover:shadow-[0_6px_16px_rgba(42,30,20,0.08)]")
      }
    >
      <div className="relative aspect-square w-full bg-sage">
        {item.imageUrl ? (
          <Image
            src={item.imageUrl}
            alt={item.name}
            fill
            sizes="(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 22vw"
            className="object-cover transition duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-6xl">
            🧋
          </div>
        )}
        {item.soldOut && (
          <div className="absolute left-3 top-3">
            <span
              className="rounded-full bg-ink2 px-2 py-0.5 text-white"
              style={{ fontSize: 9, letterSpacing: 1.1, fontWeight: 600 }}
            >
              SOLD OUT
            </span>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3.5">
        <h3
          className="font-serif text-ink line-clamp-2"
          style={{
            fontSize: 16,
            lineHeight: "20px",
            letterSpacing: -0.2,
            fontWeight: 500,
          }}
        >
          {item.name}
        </h3>
        {showVariationSubtitle && (
          <p className="text-ink3" style={{ fontSize: 11 }}>
            {item.variationLabel}
          </p>
        )}
        <div className="mt-auto flex items-end justify-between pt-2">
          {item.priceCents != null ? (
            <p className="flex flex-wrap items-baseline gap-1.5">
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
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={openItemFromButton}
            disabled={item.soldOut}
            aria-label={`Customize ${item.name}`}
            tabIndex={-1}
            className={
              "relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition " +
              (item.soldOut
                ? "bg-ink4 cursor-not-allowed"
                : "bg-brand hover:bg-brand-dark active:scale-90")
            }
          >
            <Plus size={18} className="text-white" />
          </button>
        </div>
      </div>
    </div>
  );
}
