import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Square } from "square";
import { squareClient } from "@/lib/square";
import { formatPrice } from "@/lib/utils";
import { BRAND, BUSINESS, LOYALTY } from "@/lib/constants";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ orderId: string }>;
};

/**
 * Build a map from catalogObjectId (variation ID) → image URL by
 * batch-fetching the catalog objects with related images included.
 */
async function buildImageMap(
  catalogObjectIds: string[],
): Promise<Map<string, string>> {
  const imageMap = new Map<string, string>();
  if (catalogObjectIds.length === 0) return imageMap;

  try {
    const res = await squareClient.catalog.batchGet({
      objectIds: catalogObjectIds,
      includeRelatedObjects: true,
    });

    // Build image ID → URL lookup from related objects
    const imageUrlById = new Map<string, string>();
    for (const rel of res.relatedObjects ?? []) {
      if (rel.type === "IMAGE" && rel.id) {
        const img = rel as Square.CatalogObject.Image;
        const url = img.imageData?.url;
        if (url) imageUrlById.set(rel.id, url);
      }
    }

    // Each returned object is a variation — find its parent item's image
    // via relatedObjects (ITEM type), or check if the variation itself
    // has an image.
    for (const obj of res.objects ?? []) {
      if (!obj.id) continue;

      // Variation → look for parent ITEM in related objects
      if (obj.type === "ITEM_VARIATION") {
        const vd = (obj as Square.CatalogObject.ItemVariation)
          .itemVariationData;
        const parentItemId = vd?.itemId;
        if (parentItemId) {
          // Find parent item in related objects
          const parentItem = (res.relatedObjects ?? []).find(
            (r) => r.id === parentItemId && r.type === "ITEM",
          ) as Square.CatalogObject.Item | undefined;
          const firstImageId =
            parentItem?.itemData?.imageIds?.[0];
          if (firstImageId) {
            const url = imageUrlById.get(firstImageId);
            if (url) imageMap.set(obj.id, url);
          }
        }
      }

      // ITEM type — direct image
      if (obj.type === "ITEM") {
        const itemData = (obj as Square.CatalogObject.Item).itemData;
        const firstImageId = itemData?.imageIds?.[0];
        if (firstImageId) {
          const url = imageUrlById.get(firstImageId);
          if (url) {
            imageMap.set(obj.id, url);
            // Also map all variation IDs to this image
            for (const v of itemData?.variations ?? []) {
              if (v.id) imageMap.set(v.id, url);
            }
          }
        }
      }
    }
  } catch {
    // Non-critical — fall back to no images
  }

  return imageMap;
}

export default async function OrderConfirmationPage({ params }: PageProps) {
  const { orderId } = await params;

  let order;
  try {
    const response = await squareClient.orders.get({ orderId });
    order = response.order;
  } catch {
    notFound();
  }

  if (!order) notFound();

  const pickup = order.fulfillments?.[0]?.pickupDetails;

  // Pickup number is written to Square's ticketName at order creation
  // (see /api/orders/route.ts). Staff see the same number on the POS
  // / Dashboard. Fall back to the tail of the order id for orders
  // placed before this feature existed.
  const pickupNumber =
    order.ticketName ||
    (order.id ? `#${order.id.slice(-4).toUpperCase()}` : "");

  // Collect catalog object IDs from line items to fetch product images
  const catalogIds = (order.lineItems ?? [])
    .map((li) => li.catalogObjectId)
    .filter((id): id is string => !!id);
  const imageMap = await buildImageMap([...new Set(catalogIds)]);

  // Count total drink items for loyalty stars earned
  const totalDrinkItems = order.lineItems?.reduce(
    (sum, li) => sum + (parseInt(li.quantity ?? "1", 10)),
    0
  ) ?? 0;

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-4 py-8 sm:px-6 sm:py-12">
      {/* Green checkmark */}
      <div className="mb-5 flex justify-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#D5E3D0]">
          <svg
            className="h-8 w-8 text-[#5B7A52]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={3}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
      </div>

      {/* Heading */}
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-[#5B7A52] sm:text-3xl">
          Ready for Pickup Soon!
        </h1>
        <p className="mt-2 text-sm text-zinc-500 leading-relaxed">
          Our tea masters are crafting your order. We&apos;ll have
          <br className="hidden sm:block" />
          it ready for you at the counter shortly.
        </p>
      </div>

      {/* Pickup number — big, so staff and customer can match on it */}
      <div
        className="mb-6 rounded-2xl border border-black/5 bg-white p-5 text-center shadow-sm"
      >
        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
          Your Pickup Number
        </p>
        <p
          className="mt-1 text-5xl font-extrabold tracking-tight sm:text-6xl"
          style={{ color: BRAND.primaryColor }}
        >
          {pickupNumber}
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          Show this number at the counter to collect your order.
        </p>
      </div>

      {/* Pickup Location + Estimated Time cards */}
      <div className="mb-6 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-black/5 bg-white p-4 text-center shadow-sm">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
            Pickup Location
          </p>
          <p className="mt-1.5 text-base font-bold text-zinc-900">
            {BUSINESS.name.replace("Mandy's Bubble Tea", "Southport")}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {BUSINESS.address}
          </p>
        </div>
        <div className="rounded-xl border border-black/5 bg-white p-4 text-center shadow-sm">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
            Estimated Pickup Time
          </p>
          <p className="mt-1.5 text-2xl font-bold text-zinc-900">
            15–20 mins
          </p>
        </div>
      </div>

      {/* Loyalty stars banner */}
      <div className="mb-6 rounded-2xl bg-gradient-to-r from-[#7B5B3A] to-[#A0784C] p-5 text-white shadow-md">
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full border border-white/50 text-[10px]">
            ⭐
          </span>
          <span className="text-sm font-semibold">
            Stars Earned: +{totalDrinkItems}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <p className="text-xs text-white/80">
            Current Progress: {totalDrinkItems}/{LOYALTY.starsPerReward} Stars
          </p>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-white/70">
            {totalDrinkItems >= LOYALTY.starsPerReward
              ? "Next Goal Reached"
              : `${LOYALTY.starsPerReward - totalDrinkItems} more to go`}
          </p>
        </div>
        {/* Progress bar */}
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/20">
          <div
            className="h-full rounded-full bg-[#D4934C] transition-all"
            style={{
              width: `${Math.min(
                (totalDrinkItems / LOYALTY.starsPerReward) * 100,
                100
              )}%`,
            }}
          />
        </div>
        {totalDrinkItems >= LOYALTY.starsPerReward && (
          <p className="mt-2 text-sm font-bold text-[#FFD700]">
            You&apos;ve earned a free drink!
          </p>
        )}
      </div>

      {/* Order Summary */}
      <section className="mb-8">
        <h2 className="mb-3 text-base font-semibold text-zinc-900">
          Order Summary
        </h2>
        <div className="space-y-3">
          {order.lineItems?.map((li, idx) => {
            // Build modifier/variation summary
            const details: string[] = [];
            if (li.variationName) details.push(li.variationName);
            if (li.modifiers) {
              li.modifiers.forEach((m) => {
                if (m.name) details.push(m.name);
              });
            }

            const imgUrl = li.catalogObjectId
              ? imageMap.get(li.catalogObjectId)
              : undefined;

            return (
              <div
                key={li.uid ?? idx}
                className="flex items-center gap-4 rounded-xl border border-black/5 bg-white p-3 shadow-sm"
              >
                <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-full bg-[#F5E6C8]">
                  {imgUrl ? (
                    <Image
                      src={imgUrl}
                      alt={li.name ?? "Item"}
                      width={56}
                      height={56}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-2xl">
                      🧋
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-zinc-900">
                    {li.name ?? "Item"}
                  </p>
                  {details.length > 0 && (
                    <p className="mt-0.5 truncate text-xs text-zinc-500">
                      {details.join(" • ")}
                    </p>
                  )}
                </div>
                <span
                  className="text-sm font-semibold"
                  style={{ color: BRAND.primaryColor }}
                >
                  {li.quantity}x
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Action buttons */}
      <div className="flex gap-3">
        <Link
          href={`/order-confirmation/${orderId}`}
          className="flex flex-1 items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold text-white shadow-md"
          style={{ backgroundColor: BRAND.primaryColor }}
        >
          Check Pickup Status
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </Link>
        <Link
          href="/"
          className="flex flex-1 items-center justify-center rounded-full border border-black/10 bg-white py-3 text-sm font-semibold text-zinc-600 shadow-sm"
        >
          Back to Home
        </Link>
      </div>
    </main>
  );
}
