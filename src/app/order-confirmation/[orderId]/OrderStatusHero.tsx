"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { BRAND, DELIVERY_DRIVER } from "@/lib/constants";
import { FreshnessBar, type Tracking } from "./DeliveryMap";

// Leaflet touches `window` at import time — load the map client-side only.
const DeliveryMap = dynamic(
  () => import("./DeliveryMap").then((m) => m.DeliveryMap),
  { ssr: false },
);

export type FulfillmentState =
  | "PROPOSED"
  | "RESERVED"
  | "PREPARED"
  | "COMPLETED"
  | "CANCELED"
  | "FAILED";

type Props = {
  orderId: string;
  initialState: FulfillmentState | null;
  isDelivery?: boolean;
  orderNumber?: string | null;
  deliveryAddress?: string | null;
  etaText?: string | null;
};

const POLL_MS = 5000;

const TERMINAL: ReadonlySet<FulfillmentState> = new Set([
  "COMPLETED",
  "CANCELED",
  "FAILED",
]);

export function OrderStatusHero({
  orderId,
  initialState,
  isDelivery = false,
  orderNumber,
  deliveryAddress,
  etaText,
}: Props) {
  const [state, setState] = useState<FulfillmentState | null>(initialState);
  const [tracking, setTracking] = useState<Tracking | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (state && TERMINAL.has(state)) return;

    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch(`/api/orders/${orderId}/status`, {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          ok: boolean;
          state: FulfillmentState | null;
          tracking: Tracking | null;
        };
        if (cancelled) return;
        if (data.ok && data.state && data.state !== stateRef.current) {
          setState(data.state);
        }
        // tracking is only populated for delivery orders that are PREPARED.
        if (data.ok) setTracking(data.tracking ?? null);
      } catch {
        // Ignore transient network errors — next tick will retry.
      }
    };

    tick(); // fetch immediately so the live map/sheet appears without a 5s wait
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [orderId, state]);

  // Out for delivery → take over the screen with a full-bleed live map and an
  // Uber-Eats-style bottom sheet floating on top. Other states keep the normal
  // in-flow confirmation hero.
  if (isDelivery && state === "PREPARED" && tracking) {
    return (
      <DeliveryTrackingView
        tracking={tracking}
        orderNumber={orderNumber}
        deliveryAddress={deliveryAddress}
        etaText={etaText}
      />
    );
  }

  const ui = stateToUi(state, isDelivery);

  return (
    <>
      <div className="mb-5 flex justify-center">
        <div
          className="flex h-16 w-16 items-center justify-center rounded-full"
          style={{ backgroundColor: ui.iconBg }}
          aria-hidden="true"
        >
          {ui.icon}
        </div>
      </div>

      <div
        className="mb-6 text-center"
        role="status"
        aria-live="polite"
      >
        <h1
          className="text-2xl font-bold tracking-tight sm:text-3xl"
          style={{ color: ui.headingColor }}
        >
          {ui.heading}
        </h1>
        <p className="mt-2 text-sm text-zinc-500 leading-relaxed">
          {ui.body}
        </p>
      </div>
    </>
  );
}

// Full-screen live tracker: map fills the viewport, a bottom sheet overlays the
// status + driver + key order info. Mirrors the Uber Eats "on the way" screen.
function DeliveryTrackingView({
  tracking,
  orderNumber,
  deliveryAddress,
  etaText,
}: {
  tracking: Tracking;
  orderNumber?: string | null;
  deliveryAddress?: string | null;
  etaText?: string | null;
}) {
  const hasDriver = tracking.driverLat != null && tracking.driverLng != null;
  // The site header stays in normal flow at the very top; we start the overlay
  // right below it so the header shows over the map (rather than covering it
  // with a full-viewport fixed layer). Measured live so it tracks the header's
  // real height (mobile vs desktop, holiday banner, etc.).
  const [topOffset, setTopOffset] = useState(64);

  // Lock background scroll while the overlay owns the screen.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const measure = () => {
      const header = document.querySelector("header");
      const bottom = header?.getBoundingClientRect().bottom ?? 64;
      setTopOffset(Math.max(0, Math.round(bottom)));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-30"
      style={{ top: topOffset, backgroundColor: "#E8E5DE" }}
    >
      {/* Full-bleed live map. z-0 establishes a stacking context so Leaflet's
          internal panes (z-index up to ~700) stay trapped beneath the overlays. */}
      <div className="absolute inset-0 z-0">
        <DeliveryMap tracking={tracking} />
      </div>

      {/* Top: live freshness chip */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center px-4"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 14px)" }}
      >
        <FreshnessBar
          hasDriver={hasDriver}
          locationUpdatedAt={tracking.locationUpdatedAt}
        />
      </div>

      {/* Bottom sheet */}
      <div className="absolute inset-x-0 bottom-0 z-10">
        <div
          className="mx-auto max-w-lg rounded-t-3xl bg-white px-5 pt-3 shadow-[0_-8px_30px_rgba(0,0,0,0.14)]"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 18px)" }}
        >
          <div
            className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-zinc-200"
            aria-hidden="true"
          />
          <h1
            className="text-xl font-bold tracking-tight"
            style={{ color: BRAND.primaryColor }}
          >
            Out for Delivery!
          </h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            Your driver is on the way to your address.
          </p>

          <div className="mt-4 border-t border-black/5 pt-4">
            <DriverCard bare />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <InfoTile label="Order Number" value={orderNumber || "—"} accent />
            <InfoTile label="ETA" value={etaText || "Soon"} />
          </div>

          <p className="mt-3 text-center text-xs text-zinc-500">
            <span className="font-semibold text-zinc-600">Delivering to</span>{" "}
            {deliveryAddress || "Address on file"}
          </p>

          <Link
            href="/"
            className="mt-3 block text-center text-xs font-medium text-zinc-400"
          >
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}

function InfoTile({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl bg-[#FAF6EF] px-3 py-2.5 text-center">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
        {label}
      </p>
      <p
        className={`mt-0.5 truncate font-bold ${accent ? "text-xl" : "text-base"} text-zinc-900`}
        style={accent ? { color: BRAND.primaryColor } : undefined}
      >
        {value}
      </p>
    </div>
  );
}

// Uber-Eats-style driver strip: avatar, name, one-tap call. `bare` drops the
// outer card chrome for use inside the tracking sheet (already on white).
function DriverCard({ bare = false }: { bare?: boolean }) {
  return (
    <div
      className={
        bare
          ? "flex items-center gap-3"
          : "mb-6 flex items-center gap-3 rounded-2xl border border-black/5 bg-white p-4 shadow-sm"
      }
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/driver-avatar.png"
        alt=""
        aria-hidden="true"
        className="h-12 w-12 shrink-0 rounded-full bg-white object-cover"
        style={{ border: `2px solid ${BRAND.primaryColor}` }}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
          Your Driver
        </p>
        <p className="truncate text-base font-bold text-zinc-900">
          {DELIVERY_DRIVER.name}
        </p>
        <p className="truncate text-xs text-zinc-500">
          On the way with your order
        </p>
      </div>
      <a
        href={`tel:${DELIVERY_DRIVER.phone}`}
        aria-label={`Call ${DELIVERY_DRIVER.name}`}
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white shadow-sm transition active:scale-95"
        style={{ backgroundColor: "#3FA55C" }}
      >
        <PhoneIcon />
      </a>
    </div>
  );
}

function PhoneIcon() {
  return (
    <svg
      className="h-5 w-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"
      />
    </svg>
  );
}

type Ui = {
  heading: string;
  body: string;
  headingColor: string;
  iconBg: string;
  icon: React.ReactNode;
};

function stateToUi(state: FulfillmentState | null, isDelivery: boolean): Ui {
  switch (state) {
    case "PREPARED":
      return {
        heading: isDelivery ? "Out for Delivery!" : "Ready for Pickup!",
        body: isDelivery
          ? "Your order is made and our team is on the way to your address."
          : "Your order is ready at the counter. Come grab it — show your pickup number to our team.",
        headingColor: BRAND.primaryColor,
        iconBg: "#FDE5DD",
        icon: <BagIcon color={BRAND.primaryColor} />,
      };
    case "COMPLETED":
      return {
        heading: isDelivery ? "Delivered" : "Picked Up",
        body: "Enjoy your drink! Thanks for visiting Mandy's Bubble Tea.",
        headingColor: "#5B7A52",
        iconBg: "#D5E3D0",
        icon: <CheckIcon color="#5B7A52" />,
      };
    case "CANCELED":
    case "FAILED":
      return {
        heading: "Order Canceled",
        body: "This order was canceled. If you were charged, please speak to a team member at the counter.",
        headingColor: "#6B7280",
        iconBg: "#E5E7EB",
        icon: <XIcon color="#6B7280" />,
      };
    case "PROPOSED":
    case "RESERVED":
    default:
      return {
        heading: isDelivery ? "Order Confirmed!" : "Ready for Pickup Soon!",
        body: isDelivery
          ? "Our tea masters are crafting your order — our team will deliver it to your door shortly."
          : "Our tea masters are crafting your order. We'll have it ready for you at the counter shortly.",
        headingColor: "#5B7A52",
        iconBg: "#D5E3D0",
        icon: <CheckIcon color="#5B7A52" />,
      };
  }
}

function CheckIcon({ color }: { color: string }) {
  return (
    <svg
      className="h-8 w-8"
      style={{ color }}
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
  );
}

function BagIcon({ color }: { color: string }) {
  return (
    <svg
      className="h-8 w-8"
      style={{ color }}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16 11V7a4 4 0 10-8 0v4M5 9h14l-1 12H6L5 9z"
      />
    </svg>
  );
}

function XIcon({ color }: { color: string }) {
  return (
    <svg
      className="h-8 w-8"
      style={{ color }}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={3}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  );
}
