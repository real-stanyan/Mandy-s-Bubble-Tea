"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Plus, Check } from "lucide-react";
import { formatPrice } from "@/lib/utils";
import { useCart } from "@/store/cart";

export type ProductRowData = {
  id: string;
  name: string;
  imageUrl: string | null;
  priceCents: number | null;
  variationLabel: string | null;
  soldOut: boolean;
  categorySlug: string;
  defaultVariation: {
    id: string;
    name: string;
    priceCents: number;
  } | null;
};

export function ProductRow({ item }: { item: ProductRowData }) {
  const router = useRouter();
  const addLine = useCart((s) => s.addLine);
  const [justAdded, setJustAdded] = useState(false);

  const showVariationSubtitle =
    item.variationLabel &&
    item.variationLabel.toLowerCase() !== "regular";

  function openItem() {
    if (item.soldOut) return;
    router.push(`/menu/${item.categorySlug}/${item.id}`);
  }

  function quickAdd(e: React.MouseEvent) {
    e.stopPropagation();
    if (item.soldOut || !item.defaultVariation) return;
    addLine({
      itemId: item.id,
      itemName: item.name,
      itemImageUrl: item.imageUrl,
      variationId: item.defaultVariation.id,
      variationName: item.defaultVariation.name,
      variationPriceCents: BigInt(item.defaultVariation.priceCents),
      modifiers: [],
    });
    setJustAdded(true);
    window.setTimeout(() => setJustAdded(false), 420);
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
              SOLD OUT
            </span>
          )}
        </div>
        {showVariationSubtitle && (
          <p className="text-ink3 mt-0.5" style={{ fontSize: 11 }}>
            {item.variationLabel}
          </p>
        )}
        {item.priceCents != null && (
          <p className="text-ink2 mt-0.5" style={{ fontSize: 14, fontWeight: 600 }}>
            {formatPrice(item.priceCents)}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={quickAdd}
        disabled={item.soldOut || !item.defaultVariation}
        aria-label={`Quick add ${item.name} to cart`}
        className={
          "relative inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full transition " +
          (item.soldOut || !item.defaultVariation
            ? "bg-ink4 cursor-not-allowed"
            : "bg-brand active:scale-90")
        }
      >
        <Plus
          size={18}
          className="absolute text-white transition-opacity"
          style={{ opacity: justAdded ? 0 : 1 }}
        />
        <Check
          size={18}
          className="absolute text-white transition-opacity"
          style={{ opacity: justAdded ? 1 : 0 }}
        />
      </button>
    </div>
  );
}
