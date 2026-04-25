"use client";

import { useEffect, useRef, useState } from "react";
import { BRAND } from "@/lib/constants";

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
};

const POLL_MS = 5000;

const TERMINAL: ReadonlySet<FulfillmentState> = new Set([
  "COMPLETED",
  "CANCELED",
  "FAILED",
]);

type UberStatus =
  | "pending"
  | "pickup"
  | "pickup_complete"
  | "dropoff"
  | "delivered"
  | "canceled"
  | "failed"
  | "returned";

export function OrderStatusHero({ orderId, initialState, isDelivery = false }: Props) {
  const [state, setState] = useState<FulfillmentState | null>(initialState);
  const [uberStatus, setUberStatus] = useState<UberStatus | null>(null);
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
        };
        if (cancelled) return;
        if (data.ok && data.state && data.state !== stateRef.current) {
          setState(data.state);
        }
      } catch {
        // Ignore transient network errors — next tick will retry.
      }
    };

    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [orderId, state]);

  // Live Uber status (delivery only) — drives finer-grained copy than the
  // Square fulfillment.state webhook can give us.
  useEffect(() => {
    if (!isDelivery) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/orders/${orderId}/delivery-status`, {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { ok: boolean; status?: UberStatus };
        if (!cancelled && data.ok && data.status) setUberStatus(data.status);
      } catch {
        // Ignore — next tick retries.
      }
    };
    tick();
    const id = setInterval(tick, 2_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [orderId, isDelivery]);

  const ui =
    isDelivery && uberStatus
      ? uberStatusToUi(uberStatus)
      : stateToUi(state, isDelivery);

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

type Ui = {
  heading: string;
  body: string;
  headingColor: string;
  iconBg: string;
  icon: React.ReactNode;
};

function uberStatusToUi(status: UberStatus): Ui {
  switch (status) {
    case "pending":
      return {
        heading: "Order Confirmed — Finding Driver",
        body: "We're matching your order with a nearby driver. This usually takes under a minute.",
        headingColor: "#5B7A52",
        iconBg: "#D5E3D0",
        icon: <CheckIcon color="#5B7A52" />,
      };
    case "pickup":
      return {
        heading: "Driver On The Way to Shop",
        body: "Your driver is heading to Mandy's to pick up your order.",
        headingColor: BRAND.primaryColor,
        iconBg: "#FDE5DD",
        icon: <BagIcon color={BRAND.primaryColor} />,
      };
    case "pickup_complete":
      return {
        heading: "Picked Up!",
        body: "Your driver has your order and is leaving the shop now.",
        headingColor: BRAND.primaryColor,
        iconBg: "#FDE5DD",
        icon: <BagIcon color={BRAND.primaryColor} />,
      };
    case "dropoff":
      return {
        heading: "On The Way to You!",
        body: "Your driver is en route. Track them on the map below.",
        headingColor: BRAND.primaryColor,
        iconBg: "#FDE5DD",
        icon: <BagIcon color={BRAND.primaryColor} />,
      };
    case "delivered":
      return {
        heading: "Delivered",
        body: "Enjoy your drink! Thanks for ordering from Mandy's.",
        headingColor: "#5B7A52",
        iconBg: "#D5E3D0",
        icon: <CheckIcon color="#5B7A52" />,
      };
    case "canceled":
    case "failed":
    case "returned":
      return {
        heading: "Delivery Canceled",
        body: "This delivery was canceled. If you were charged, refunds will appear in 3–5 days.",
        headingColor: "#6B7280",
        iconBg: "#E5E7EB",
        icon: <XIcon color="#6B7280" />,
      };
  }
}

function stateToUi(state: FulfillmentState | null, isDelivery: boolean): Ui {
  switch (state) {
    case "PREPARED":
      return {
        heading: isDelivery ? "Out for Delivery!" : "Ready for Pickup!",
        body: isDelivery
          ? "Your driver is on the way. Tap the tracking link below to follow along."
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
        heading: isDelivery ? "Order Confirmed — Dispatching Driver" : "Ready for Pickup Soon!",
        body: isDelivery
          ? "We're sending your order to a driver. You'll get a tracking link once they're on the way."
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
