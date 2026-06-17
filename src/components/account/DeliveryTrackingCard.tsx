"use client";

import { useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Clock, Phone } from "lucide-react";
import { DELIVERY_DRIVER } from "@/lib/constants";
import { FreshnessBar, type Tracking } from "@/components/delivery/DeliveryMap";
import type { OrderHistoryItem } from "@/components/account/OrderRow";

// Inline live-delivery tracking card for the Orders list active slot, recreated
// from the design_handoff delivery variant (previously app-only). It mirrors the
// full-screen tracker on /order-confirmation/[orderId] (OrderStatusHero's
// DeliveryTrackingView) but contained inside a card: a small live map up top,
// then the out-for-delivery status, order number, and the driver strip.
//
// Driver identity is the hardcoded DELIVERY_DRIVER (single self-delivery driver)
// — same as the confirmation page. Live position/route/ETA come from the same
// /api/orders/[id]/status poll the confirmation page uses (only populated for the
// authenticated owner once the order is PREPARED / out for delivery).

// Leaflet touches `window` at import time — load the map client-side only.
const DeliveryMap = dynamic(
  () => import("@/components/delivery/DeliveryMap").then((m) => m.DeliveryMap),
  { ssr: false },
);

const POLL_MS = 5000;

function displayNumber(order: OrderHistoryItem): string {
  const ref = order.referenceId?.trim();
  if (ref) return ref;
  return `#${order.id.slice(-4).toUpperCase()}`;
}

// Live ETA from the server's Google Directions duration (re-routed as the driver
// moves). Null when unavailable — the pill is hidden rather than guessing.
function liveEta(etaSeconds: number | null | undefined): string | null {
  if (etaSeconds == null || !Number.isFinite(etaSeconds) || etaSeconds <= 0)
    return null;
  return `${Math.max(1, Math.ceil(etaSeconds / 60))} min`;
}

/**
 * Container: polls the order status. Once the order is out for delivery
 * (PREPARED) and the owner-gated tracking payload is available, renders the
 * inline live card; otherwise renders `fallback` (the standard active card).
 */
export function DeliveryTrackingCard({
  order,
  fallback,
}: {
  order: OrderHistoryItem;
  fallback: ReactNode;
}) {
  const [state, setState] = useState<string | null>(order.fulfillmentState);
  const [tracking, setTracking] = useState<Tracking | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/orders/${order.id}/status`, {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          ok: boolean;
          state: string | null;
          tracking: Tracking | null;
        };
        if (cancelled || !data.ok) return;
        if (data.state) setState(data.state);
        setTracking(data.tracking ?? null);
      } catch {
        // transient network error — next tick retries
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [order.id]);

  if (state === "PREPARED" && tracking) {
    return <InlineTrackingCard order={order} tracking={tracking} />;
  }
  return <>{fallback}</>;
}

/** Presentational inline tracking card — pure props, mirrors the design mockup. */
export function InlineTrackingCard({
  order,
  tracking,
}: {
  order: OrderHistoryItem;
  tracking: Tracking;
}) {
  const hasDriver = tracking.driverLat != null && tracking.driverLng != null;
  const eta = liveEta(tracking.etaSeconds);

  return (
    <div className="overflow-hidden rounded-[22px] border-[1.5px] border-brand shadow-[0_14px_32px_rgba(141,85,36,0.16)]">
      {/* live map — z-0 wrapper traps Leaflet's internal panes beneath the
          overlay chips (mirrors the full-screen tracker on the detail page) */}
      <div className="relative h-[190px] w-full" style={{ background: "#E8E5DE" }}>
        <div className="absolute inset-0 z-0">
          <DeliveryMap tracking={tracking} />
        </div>
        <div className="pointer-events-none absolute left-3 top-3 z-10">
          <FreshnessBar
            hasDriver={hasDriver}
            locationUpdatedAt={tracking.locationUpdatedAt}
          />
        </div>
        {eta && (
          <span className="absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-[13px] font-bold text-white shadow-md">
            <Clock size={14} /> {eta}
          </span>
        )}
      </div>

      {/* body */}
      <div
        className="p-5"
        style={{ background: "linear-gradient(180deg,#FFF7EC,#FFF1DE)" }}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-white py-[7px] pl-[11px] pr-3.5">
            <span className="h-[9px] w-[9px] rounded-full bg-green" />
            <span className="text-[13px] font-bold text-green-dark">
              Out for delivery
            </span>
          </span>
          <span className="text-[11.5px] font-bold uppercase tracking-wide text-ink3">
            Delivery
          </span>
        </div>

        {/* prominent order number — quoted to the driver on arrival */}
        <Link
          href={`/order-confirmation/${order.id}`}
          className="mt-4 block rounded-2xl px-[18px] py-4 transition active:scale-[0.99]"
          style={{
            background: "rgba(255,255,255,0.6)",
            border: "1.5px dashed rgba(141,85,36,0.38)",
          }}
        >
          <div className="flex items-center justify-between gap-2.5">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.13em] text-brand">
              Order number
            </span>
            <span className="text-[12px] font-semibold text-ink3">
              Quote on delivery
            </span>
          </div>
          <div className="mt-2 whitespace-nowrap font-mono text-[40px] font-bold leading-none tracking-[2px] text-ink">
            {displayNumber(order)}
          </div>
        </Link>

        {/* driver strip */}
        <div
          className="mt-4 flex items-center gap-3 border-t pt-4"
          style={{ borderColor: "rgba(141,85,36,0.14)" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/driver-avatar.png"
            alt=""
            aria-hidden="true"
            className="h-12 w-12 shrink-0 rounded-full border-2 border-brand bg-white object-cover"
          />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-ink4">
              Your driver
            </p>
            <p className="truncate text-base font-bold text-ink">
              {DELIVERY_DRIVER.name}
            </p>
            <p className="truncate text-xs text-ink3">
              On the way with your order
            </p>
          </div>
          <a
            href={`tel:${DELIVERY_DRIVER.phone}`}
            aria-label={`Call ${DELIVERY_DRIVER.name}`}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white shadow-sm transition active:scale-95"
            style={{ backgroundColor: "#3CA96E" }}
          >
            <Phone size={20} />
          </a>
        </div>
      </div>
    </div>
  );
}
