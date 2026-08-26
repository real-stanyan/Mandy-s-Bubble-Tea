"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Clock, ChevronDown, ArrowRight, RotateCcw } from "lucide-react";
import { formatPrice } from "@/lib/utils";
import type { OrderHistoryItem } from "@/components/account/OrderRow";
import { DeliveryTrackingCard } from "@/components/account/DeliveryTrackingCard";
import { useCart } from "@/store/cart";

// Redesigned Your Orders surface, recreated from
// design_handoff_account_auth's web-account.jsx OrdersPage. Pure props so
// it renders in the dev preview with mock orders (no session needed).
//
// Delivery variant: an active DELIVERY order out for delivery renders an inline
// live tracking card (DeliveryTrackingCard) — small live map + ETA + driver +
// call — mirroring the full-screen tracker on /order-confirmation/[orderId].
// Before it's out for delivery (and for pickup orders) the standard active card
// with the Received → Making → Ready stepper is shown.

const STEPS = ["Received", "Making", "Ready"] as const;

function displayNumber(order: OrderHistoryItem): string {
  const ref = order.referenceId?.trim();
  if (ref) return ref;
  return `#${order.id.slice(-4).toUpperCase()}`;
}

function isActive(order: OrderHistoryItem): boolean {
  // Server-computed: OPEN + placed today (Brisbane) + not yet fulfilled.
  // (Square state stays OPEN forever for self-delivery / uncompleted pickups,
  // so we no longer key off state alone — see /api/orders/history.)
  return order.active === true;
}

/** Active-order status → progress step + label + tone. */
function activeMeta(order: OrderHistoryItem): {
  label: string;
  step: number;
  tone: "green" | "amber";
} {
  const ready = order.state === "OPEN" && order.fulfillmentState === "PREPARED";
  if (ready) return { label: "Ready", step: 2, tone: "green" };
  return { label: "In progress", step: 1, tone: "amber" };
}

function whenText(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-AU", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

function modeLabel(order: OrderHistoryItem): string {
  return order.fulfillmentType === "DELIVERY" ? "Delivery" : "Pickup";
}

function OrderThumb({
  order,
  size = 56,
}: {
  order: OrderHistoryItem;
  size?: number;
}) {
  if (order.firstItemImageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={order.firstItemImageUrl}
        alt={order.firstItemName ?? "Order item"}
        width={size}
        height={size}
        className="shrink-0 rounded-[14px] border border-line object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="grid shrink-0 place-items-center rounded-[14px] border border-line bg-cream text-[22px]"
      style={{ width: size, height: size }}
    >
      🧋
    </span>
  );
}

// Active-order slot. Delivery orders delegate to DeliveryTrackingCard, which
// shows the inline live tracker once out for delivery and otherwise falls back
// to the standard stepper card. Pickup orders always get the standard card.
function ActiveOrderCard({ order }: { order: OrderHistoryItem }) {
  if (order.fulfillmentType === "DELIVERY") {
    return (
      <DeliveryTrackingCard
        order={order}
        fallback={<StandardActiveCard order={order} />}
      />
    );
  }
  return <StandardActiveCard order={order} />;
}

function StandardActiveCard({ order }: { order: OrderHistoryItem }) {
  const meta = activeMeta(order);
  const dotClass = meta.tone === "green" ? "bg-green" : "bg-star";
  const labelClass = meta.tone === "green" ? "text-green-dark" : "text-brand";
  return (
    <Link
      href={`/order-confirmation/${order.id}`}
      className="block overflow-hidden rounded-[22px] border-[1.5px] border-brand p-6 shadow-[0_14px_32px_rgba(141,85,36,0.16)] transition active:scale-[0.99]"
      style={{ background: "linear-gradient(180deg,#FFF7EC,#FFF1DE)" }}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-white py-[7px] pl-[11px] pr-3.5">
          <span className={`h-[9px] w-[9px] rounded-full ${dotClass}`} />
          <span className={`text-[11.5px] font-bold ${labelClass}`}>
            {meta.label}
          </span>
        </span>
        <span className="text-[11.5px] font-bold uppercase tracking-wide text-ink3">
          {modeLabel(order)}
        </span>
      </div>

      {/* prominent order number — shown at the counter */}
      <div
        className="mt-4 rounded-2xl px-[18px] py-4"
        style={{
          background: "rgba(255,255,255,0.6)",
          border: "1.5px dashed rgba(141,85,36,0.38)",
        }}
      >
        <div className="flex items-center justify-between gap-2.5">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.13em] text-brand">
            Order number
          </span>
          <span className="text-[11px] font-semibold text-ink3">
            {order.fulfillmentType === "DELIVERY"
              ? "Quote this on delivery"
              : "Show this at the counter"}
          </span>
        </div>
        <div className="mt-2 whitespace-nowrap font-mono text-[40px] font-bold leading-none tracking-[2px] text-ink">
          {displayNumber(order)}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3.5">
        <OrderThumb order={order} size={56} />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold leading-snug text-ink">
            {order.itemSummary ||
              `${order.lineCount} item${order.lineCount !== 1 ? "s" : ""}`}
          </p>
          {order.createdAt && (
            <p className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold text-brand">
              <Clock size={13} /> {whenText(order.createdAt)}
            </p>
          )}
        </div>
      </div>

      {/* progress steps */}
      <div className="mt-5 flex items-center gap-2">
        {STEPS.map((label, i) => {
          const done = i <= meta.step;
          return (
            <div key={label} className="flex flex-1 items-center gap-2 last:flex-none">
              <div className="flex flex-col items-center gap-1.5">
                <span
                  className={`grid h-[22px] w-[22px] place-items-center rounded-full ${
                    done ? "bg-brand text-white" : "border-[1.5px] border-line bg-white"
                  }`}
                >
                  {done && <Check size={13} />}
                </span>
                <span
                  className={`text-[10px] font-semibold ${
                    done ? "text-ink" : "text-ink4"
                  }`}
                >
                  {label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <span
                  className={`mb-[17px] h-[2.5px] flex-1 rounded ${
                    i < meta.step ? "bg-brand" : "bg-line"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      <div
        className="mt-[18px] flex items-center justify-between border-t pt-4"
        style={{ borderColor: "rgba(141,85,36,0.14)" }}
      >
        <span className="text-[11.5px] font-semibold text-ink2">
          {modeLabel(order)} · {order.lineCount} drink
          {order.lineCount !== 1 ? "s" : ""}
        </span>
        <span className="text-[17.5px] font-bold text-brand">
          {formatPrice(BigInt(order.totalCents))}
        </span>
      </div>
    </Link>
  );
}

function PastOrderCard({ order }: { order: OrderHistoryItem }) {
  const router = useRouter();
  const addLine = useCart((s) => s.addLine);
  const clearCart = useCart((s) => s.clear);
  const openDrawer = useCart((s) => s.openDrawer);
  const canceled = order.state === "CANCELED";
  const total = BigInt(order.totalCents);
  const title =
    order.itemSummary ||
    `${order.lineCount} item${order.lineCount !== 1 ? "s" : ""}`;

  // Rebuild the exact cart from the past order's lines and open the cart.
  // Reorder REPLACES the current cart (clear first) — it's "order this again",
  // not "add to what I'm building", so tapping it twice doesn't stack orders.
  // Prices/names come straight off the historical lines; Square re-prices
  // against the live catalog at checkout, and a since-removed variation is
  // caught by the existing sold-out guard on order creation. Falls back to
  // the menu only if this payload predates lineItems.
  function reorder() {
    const lines = order.lineItems ?? [];
    if (lines.length === 0) {
      router.push("/menu");
      return;
    }
    clearCart();
    for (const li of lines) {
      addLine(
        {
          itemId: li.itemId,
          itemName: li.name,
          itemImageUrl: li.imageUrl,
          variationId: li.variationId,
          variationName: li.variationName,
          variationPriceCents: BigInt(li.basePriceCents),
          modifiers: li.modifiers.map((m) => ({
            id: m.id,
            name: m.name,
            priceCents: BigInt(m.priceCents),
          })),
        },
        li.quantity,
      );
    }
    openDrawer();
  }

  return (
    <Link
      href={`/order-confirmation/${order.id}`}
      className="flex items-stretch gap-3.5 rounded-card border border-line bg-card p-3.5 shadow-[0_2px_8px_rgba(42,30,20,0.05)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(42,30,20,0.12)]"
    >
      <OrderThumb order={order} size={58} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* what they ordered (the hero) — now full width */}
        <h3 className="truncate font-serif text-[14px] font-semibold leading-snug text-ink">
          {title}
        </h3>

        {/* mode · date · status (status carries the colour, not the price) */}
        <p className="mt-1 truncate text-[10.5px] text-ink4">
          {modeLabel(order)} · {whenText(order.createdAt)} ·{" "}
          {canceled ? (
            <span className="font-semibold text-red-600">Cancelled</span>
          ) : (
            <span className="font-semibold text-green-dark">Completed</span>
          )}
        </p>

        {/* price chip sits in the order-number slot; the order number rides
            alongside it, muted. $0 is a valid total (Star reward redemption),
            so we always show the price — including $0.00. */}
        <div className="mt-2.5 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="rounded-md bg-cream px-2 py-0.5 font-mono text-[11.5px] font-bold tracking-[0.4px] text-ink">
              {formatPrice(total)}
            </span>
            <span className="truncate font-mono text-[10px] font-semibold tracking-[0.5px] text-ink4">
              {displayNumber(order)}
            </span>
          </div>
          {!canceled && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                reorder();
              }}
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-brand/30 bg-brand/[0.06] px-3 py-1.5 text-[10.5px] font-bold text-brand transition hover:bg-brand hover:text-white"
            >
              <RotateCcw size={13} strokeWidth={2.5} /> Reorder
            </button>
          )}
        </div>
      </div>
    </Link>
  );
}

export function OrdersView({ orders }: { orders: OrderHistoryItem[] }) {
  const router = useRouter();
  const [showAll, setShowAll] = useState(false);

  const active = useMemo(() => orders.filter(isActive), [orders]);
  const past = useMemo(() => orders.filter((o) => !isActive(o)), [orders]);
  const visiblePast = showAll ? past : past.slice(0, 5);
  const hiddenCount = past.length - 5;

  return (
    <div className="px-4">
      {orders.length === 0 ? (
        <div className="rounded-card border border-line bg-card px-10 py-[60px] text-center shadow-[0_2px_8px_rgba(42,30,20,0.05)]">
          <div className="text-[52px]">🧋</div>
          <p className="mt-3 text-[13px] text-ink2">
            You haven&apos;t placed any orders yet.
          </p>
          <button
            type="button"
            onClick={() => router.push("/menu")}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-brand px-5 py-3 text-[13px] font-semibold text-white shadow-[0_12px_22px_rgba(141,85,36,0.30)] transition hover:bg-brand-dark active:scale-[0.97]"
          >
            Browse the menu <ArrowRight size={16} />
          </button>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <>
              <div className="mb-4 flex items-center gap-2.5">
                <span className="h-[9px] w-[9px] rounded-full bg-green shadow-[0_0_0_5px_rgba(60,169,110,0.16)]" />
                <h2 className="font-serif text-[20px] font-semibold tracking-[-0.4px] text-ink">
                  In progress
                </h2>
                <span className="text-[11.5px] font-bold text-ink4">
                  {active.length}
                </span>
              </div>
              <div
                className={`mb-11 grid grid-cols-1 gap-[18px] ${
                  active.length > 1 ? "lg:grid-cols-2" : ""
                }`}
              >
                {active.map((o) => (
                  <ActiveOrderCard key={o.id} order={o} />
                ))}
              </div>
            </>
          )}

          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="font-serif text-[20px] font-semibold tracking-[-0.4px] text-ink">
              Past orders
            </h2>
            {past.length > 0 && (
              <span className="text-[11.5px] font-semibold text-ink3">
                {past.length} total
              </span>
            )}
          </div>
          {past.length === 0 ? (
            <div className="rounded-card border border-line bg-card p-[30px] text-center text-[12.5px] text-ink3">
              No past orders yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              {visiblePast.map((o) => (
                <PastOrderCard key={o.id} order={o} />
              ))}
            </div>
          )}
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="mx-auto mt-5 flex items-center gap-1.5 rounded-full border border-line bg-card px-5 py-2.5 text-[13px] font-semibold text-ink2 transition hover:bg-paper"
            >
              {showAll ? "Show less" : `Show all ${past.length} orders`}
              <ChevronDown
                size={16}
                className={`transition-transform ${showAll ? "rotate-180" : ""}`}
              />
            </button>
          )}
        </>
      )}
    </div>
  );
}
