import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Square } from "square";
import { ArrowRight, MapPin, Star } from "lucide-react";
import { squareClient } from "@/lib/square";
import { formatPrice } from "@/lib/utils";
import { BUSINESS, LOYALTY } from "@/lib/constants";
import { findLoyaltyAccountByPhone, getActiveProgram } from "@/lib/loyalty";
import { estimateOrderWaitMinutes, formatWaitRange } from "@/lib/order-wait";
import { OrderComplaintSection } from "@/components/account/OrderComplaintSection";
import { OrderStatusHero, type FulfillmentState } from "./OrderStatusHero";

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
          const firstImageId = parentItem?.itemData?.imageIds?.[0];
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
  // Self-delivery orders carry a PICKUP fulfillment (Square hides DELIVERY-type
  // orders from the POS) — the truth lives in metadata.fulfillment_type.
  const isDelivery =
    order.metadata?.fulfillment_type === "DELIVERY" ||
    fulfillment?.type === "DELIVERY";
  const deliveryAddress = order.metadata?.delivery_address ?? null;

  // Pickup number is written to Square's ticketName at order creation
  // (see /api/orders/route.ts). Staff see the same number on the POS
  // / Dashboard. Fall back to the tail of the order id for orders
  // placed before this feature existed.
  const pickupNumber =
    order.ticketName ||
    (order.id ? `#${order.id.slice(-4).toUpperCase()}` : "");

  // Collect catalog object IDs from line items to fetch product images
  const lineItems = order.lineItems ?? [];
  const catalogIds = lineItems
    .map((li) => li.catalogObjectId)
    .filter((id): id is string => !!id);
  const imageMap = await buildImageMap([...new Set(catalogIds)]);

  // Count total drink items for loyalty stars earned
  const totalDrinkItems = lineItems.reduce(
    (sum, li) => sum + parseInt(li.quantity ?? "1", 10),
    0,
  );

  // Money summary — subtotal from line totals, total from the order; the delta
  // captures order-level taxes / fees / discounts (rendered as one row).
  const subtotalCents = lineItems.reduce(
    (sum, li) => sum + (li.totalMoney?.amount ?? 0n),
    0n,
  );
  const totalCents = order.totalMoney?.amount ?? subtotalCents;
  const diffCents = totalCents - subtotalCents;

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

  const progressBalance = loyaltyBalance ?? totalDrinkItems;
  const progressMod = progressBalance % starsPerReward;
  const rewardReady = progressBalance >= starsPerReward && progressMod === 0;
  const remaining = starsPerReward - progressMod;
  const progressPct = Math.min((progressMod / starsPerReward) * 100, 100);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      {/* Header */}
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.13em] text-brand">
            Order {pickupNumber}
          </p>
          <h1 className="mt-2 font-serif text-[clamp(30px,4vw,40px)] font-semibold leading-[1.0] tracking-[-0.03em] text-ink">
            Order details
          </h1>
        </div>
        <Link
          href="/menu"
          className="inline-flex items-center gap-1.5 rounded-full bg-brand px-5 py-2.5 text-[13.5px] font-semibold text-white shadow-[0_10px_18px_rgba(141,85,36,0.28)] transition hover:bg-brand-dark active:scale-[0.97]"
        >
          Reorder <ArrowRight size={15} />
        </Link>
      </div>

      <div className="grid items-start gap-7 lg:grid-cols-[1fr_360px]">
        {/* ===== Left: order number + status + items ===== */}
        <div className="flex flex-col gap-[18px]">
          {/* Prominent order number — staff + customer match on it */}
          <div
            className="flex items-center justify-between gap-4 rounded-card border-[1.5px] border-dashed p-5 sm:p-6"
            style={{
              backgroundColor: "var(--color-cream)",
              borderColor: "rgba(141,85,36,.4)",
            }}
          >
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.13em] text-brand">
                {isDelivery ? "Order number" : "Pickup number"}
              </p>
              <p className="mt-2 whitespace-nowrap font-mono text-[clamp(40px,7vw,56px)] font-bold leading-none tracking-[2px] text-ink">
                {pickupNumber}
              </p>
            </div>
            <span className="max-w-[130px] text-right text-[12.5px] font-semibold leading-snug text-ink3">
              {isDelivery
                ? "Quote this on delivery"
                : "Show this at the counter to collect"}
            </span>
          </div>

          {/* Live status (polls; takes over the screen for out-for-delivery) */}
          <OrderStatusHero
            orderId={orderId}
            initialState={initialState}
            isDelivery={isDelivery}
            orderNumber={pickupNumber}
            deliveryAddress={deliveryAddress}
            etaText={waitText}
          />

          {/* Items */}
          <div className="rounded-card border border-line bg-card p-2 shadow-[0_2px_8px_rgba(42,30,20,0.05)]">
            <h2 className="px-3.5 pb-2 pt-3 font-serif text-[18px] font-semibold text-ink">
              Items
            </h2>
            {lineItems.map((li, idx) => {
              const details: string[] = [];
              if (li.variationName) details.push(li.variationName);
              li.modifiers?.forEach((m) => {
                if (m.name) details.push(m.name);
              });
              const imgUrl = li.catalogObjectId
                ? imageMap.get(li.catalogObjectId)
                : undefined;
              const qty = parseInt(li.quantity ?? "1", 10);

              return (
                <div
                  key={li.uid ?? idx}
                  className="flex items-center gap-3.5 border-t border-line px-3.5 py-3"
                >
                  <div className="relative h-[54px] w-[54px] shrink-0 overflow-hidden rounded-tile bg-bg2">
                    {imgUrl ? (
                      <Image
                        src={imgUrl}
                        alt={li.name ?? "Item"}
                        width={54}
                        height={54}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-2xl">
                        🧋
                      </div>
                    )}
                    <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full border-2 border-card bg-ink px-1 text-[11px] font-bold text-white">
                      {qty}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold text-ink">
                      {li.name ?? "Item"}
                    </p>
                    {details.length > 0 && (
                      <p className="mt-0.5 truncate text-[12.5px] text-ink3">
                        {details.join(" · ")}
                      </p>
                    )}
                  </div>
                  {li.totalMoney?.amount != null && (
                    <span className="text-[15px] font-bold text-brand">
                      {formatPrice(li.totalMoney.amount)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ===== Right: sticky summary + loyalty ===== */}
        <div className="flex flex-col gap-[18px] lg:sticky lg:top-24">
          <div className="rounded-card border border-line bg-card p-6 shadow-[0_2px_8px_rgba(42,30,20,0.05)]">
            <h2 className="font-serif text-[20px] font-semibold tracking-[-0.4px] text-ink">
              Summary
            </h2>
            <div className="mt-4 flex flex-col gap-2.5">
              <Row label="Subtotal" value={formatPrice(subtotalCents)} />
              {diffCents !== 0n &&
                (diffCents < 0n ? (
                  <Row
                    label="Member savings & offers"
                    value={`−${formatPrice(-diffCents)}`}
                  />
                ) : (
                  <Row
                    muted
                    label={isDelivery ? "Delivery & fees" : "Taxes & fees"}
                    value={formatPrice(diffCents)}
                  />
                ))}
            </div>
            <div className="mt-3.5 flex items-baseline justify-between border-t border-line pt-3.5">
              <span className="text-[16px] font-bold text-ink">Total</span>
              <span className="text-[24px] font-bold text-brand">
                {formatPrice(totalCents)}
              </span>
            </div>

            <div className="mt-4 flex items-center gap-2.5 rounded-tile bg-cream px-3.5 py-3">
              <Star size={16} className="text-star" />
              <span className="text-[13.5px] font-semibold text-ink">
                +{totalDrinkItems} star{totalDrinkItems !== 1 ? "s" : ""} earned
              </span>
            </div>

            <div className="mt-4 flex items-start gap-2.5 border-t border-line pt-4">
              <MapPin size={16} className="mt-0.5 shrink-0 text-brand" />
              <div>
                <p className="text-[12px] font-semibold text-ink3">
                  {isDelivery ? "Delivery to" : "Pickup at"}
                </p>
                <p className="mt-0.5 text-[13.5px] font-semibold text-ink">
                  {isDelivery
                    ? (deliveryAddress ?? "Address on file")
                    : "Mandy's · Southport"}
                </p>
                {!isDelivery && (
                  <p className="mt-0.5 text-[12.5px] text-ink3">
                    {BUSINESS.address}
                  </p>
                )}
              </div>
            </div>

            <Link
              href="/menu"
              className="mt-5 flex items-center justify-center gap-1.5 rounded-full bg-brand px-5 py-3 text-sm font-semibold text-white shadow-[0_10px_18px_rgba(141,85,36,0.28)] transition hover:bg-brand-dark active:scale-[0.97]"
            >
              Reorder these drinks
            </Link>
          </div>

          {/* Loyalty progress */}
          <div className="rounded-card border border-line bg-card p-5 shadow-[0_2px_8px_rgba(42,30,20,0.05)]">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-ink">
                {progressMod}/{starsPerReward} stars
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink3">
                {rewardReady ? "Reward ready!" : `${remaining} more to go`}
              </span>
            </div>
            <div className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-bg2">
              <div
                className="h-full rounded-full bg-brand transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            {rewardReady && (
              <p className="mt-2.5 text-[13px] font-bold text-green-dark">
                You&apos;ve earned a free drink! 🎉
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Full width: complaint + back home */}
      <div className="mt-8">
        <OrderComplaintSection
          orderId={orderId}
          pickupNumber={pickupNumber}
          orderState={order.state ?? null}
          orderCustomerId={order.customerId ?? null}
        />
        <div className="mt-2 flex">
          <Link
            href="/"
            className="flex flex-1 items-center justify-center rounded-full border border-line bg-card py-3 text-sm font-semibold text-ink2 shadow-sm transition hover:bg-paper"
          >
            Back to Home
          </Link>
        </div>
      </div>
    </main>
  );
}

function Row({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-[14px]">
      <span className="text-ink2">{label}</span>
      <span className={muted ? "font-semibold text-ink3" : "font-semibold text-ink"}>
        {value}
      </span>
    </div>
  );
}
