import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Square } from "square";
import { squareClient } from "@/lib/square";
import { formatPrice } from "@/lib/utils";
import { BRAND, BUSINESS, LOYALTY } from "@/lib/constants";
import { findLoyaltyAccountByPhone, getActiveProgram } from "@/lib/loyalty";
import { estimateOrderWaitMinutes, formatWaitRange } from "@/lib/order-wait";
import {
  OrderStatusHero,
  type FulfillmentState,
} from "./OrderStatusHero";
import { LiveDeliveryStatus } from "@/components/order/LiveDeliveryStatus";

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

  const fulfillment = order.fulfillments?.[0];
  const initialState =
    (fulfillment?.state as FulfillmentState | undefined) ?? null;
  const isDelivery = fulfillment?.type === "DELIVERY";
  const trackingUrl = order.metadata?.uber_tracking_url ?? null;
  const deliveryAddress = order.metadata?.delivery_address ?? null;

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

  const waitText = formatWaitRange(await estimateOrderWaitMinutes(order));

  // Fetch real loyalty balance for the customer (if they have a loyalty account).
  // The order's customerId → customer phone → loyalty account search.
  let loyaltyBalance: number | null = null;
  let starsPerReward: number = LOYALTY.starsPerReward;
  if (order.customerId) {
    try {
      const customer = await squareClient.customers.get({
        customerId: order.customerId,
      });
      const phone = customer.customer?.phoneNumber;
      if (phone) {
        const [account, program] = await Promise.all([
          findLoyaltyAccountByPhone(phone),
          getActiveProgram(),
        ]);
        if (account) {
          loyaltyBalance = account.balance;
        }
        starsPerReward = program.starsPerReward;
      }
    } catch {
      // Non-critical — fall back to showing only stars earned this order
    }
  }

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <OrderStatusHero orderId={orderId} initialState={initialState} isDelivery={isDelivery} />

      {isDelivery && <LiveDeliveryStatus orderId={orderId} />}

      {/* Pickup number — big, so staff and customer can match on it */}
      <div
        className="mb-6 rounded-2xl border border-black/5 bg-white p-5 text-center shadow-sm"
      >
        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
          {isDelivery ? "Your Order Number" : "Your Pickup Number"}
        </p>
        <p
          className="mt-1 text-5xl font-extrabold tracking-tight sm:text-6xl"
          style={{ color: BRAND.primaryColor }}
        >
          {pickupNumber}
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          {isDelivery
            ? "Your driver will reference this number on arrival."
            : "Show this number at the counter to collect your order."}
        </p>
      </div>

      {/* Location/Address + Estimated Time cards */}
      <div className="mb-6 grid grid-cols-2 gap-3">
        {isDelivery ? (
          <div className="rounded-xl border border-black/5 bg-white p-4 text-center shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
              Delivering To
            </p>
            <p className="mt-1.5 text-sm font-bold text-zinc-900">
              {deliveryAddress ?? "Address on file"}
            </p>
            {trackingUrl && (
              <a
                href={trackingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-xs font-semibold underline"
                style={{ color: BRAND.primaryColor }}
              >
                Track delivery →
              </a>
            )}
          </div>
        ) : (
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
        )}
        <div className="rounded-xl border border-black/5 bg-white p-4 text-center shadow-sm">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
            {isDelivery ? "Estimated Delivery Time" : "Estimated Pickup Time"}
          </p>
          <p className="mt-1.5 text-2xl font-bold text-zinc-900">
            {waitText}
          </p>
        </div>
      </div>

      {/* Loyalty stars banner */}
      {(() => {
        const progressBalance = loyaltyBalance ?? totalDrinkItems;
        const progressMod = progressBalance % starsPerReward;
        const remaining = starsPerReward - progressMod;
        const rewardReady = progressBalance >= starsPerReward && progressMod === 0;
        return (
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
                Current Progress: {progressMod}/{starsPerReward} Stars
              </p>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-white/70">
                {rewardReady
                  ? "Reward Ready!"
                  : `${remaining} more to go`}
              </p>
            </div>
            {/* Progress bar */}
            <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/20">
              <div
                className="h-full rounded-full bg-[#D4934C] transition-all"
                style={{
                  width: `${Math.min(
                    (progressMod / starsPerReward) * 100,
                    100
                  )}%`,
                }}
              />
            </div>
            {rewardReady && (
              <p className="mt-2 text-sm font-bold text-[#FFD700]">
                You&apos;ve earned a free drink!
              </p>
            )}
          </div>
        );
      })()}

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

      <div className="flex">
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
