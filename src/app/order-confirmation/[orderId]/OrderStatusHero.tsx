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
};

const POLL_MS = 5000;

const TERMINAL: ReadonlySet<FulfillmentState> = new Set([
  "COMPLETED",
  "CANCELED",
  "FAILED",
]);

export function OrderStatusHero({ orderId, initialState }: Props) {
  const [state, setState] = useState<FulfillmentState | null>(initialState);
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

  const ui = stateToUi(state);

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

function stateToUi(state: FulfillmentState | null): Ui {
  switch (state) {
    case "PREPARED":
      return {
        heading: "Ready for Pickup!",
        body: "Your order is ready at the counter. Come grab it — show your pickup number to our team.",
        headingColor: BRAND.primaryColor,
        iconBg: "#FDE5DD",
        icon: <BagIcon color={BRAND.primaryColor} />,
      };
    case "COMPLETED":
      return {
        heading: "Picked Up",
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
        heading: "Ready for Pickup Soon!",
        body: "Our tea masters are crafting your order. We'll have it ready for you at the counter shortly.",
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
