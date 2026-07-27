"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { BRAND } from "@/lib/constants";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  markPopupShown,
  setPreferredFulfillment,
  wasPopupShown,
} from "@/lib/order-mode";
import type { FulfillmentType } from "@/components/checkout/FulfillmentSelector";
import { useAppDownloadPopupEligibility } from "@/hooks/use-app-download-popup-eligibility";

const DELIVERY_ENV_MASTER = process.env.NEXT_PUBLIC_DELIVERY_ENABLED === "true";

// Order-mode popup, shown once per session to logged-in visitors on the home
// page. The two buttons set a session-scoped Checkout default (PICKUP /
// DELIVERY). Only relevant — and only shown — when delivery is enabled, since
// otherwise there is no choice to make. Delivery availability is the live boss
// toggle (app_settings.delivery_enabled via /api/store-status) ANDed with the
// build-time env master. Mutually exclusive with LoyaltyPopup, which targets
// logged-out visitors, and yields to the app-download campaign popup, which
// (unlike LoyaltyPopup) also shows to signed-in visitors.

export function OrderModePopup() {
  const { profile, loading } = useAuth();
  const appDownload = useAppDownloadPopupEligibility();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (loading || !profile || !DELIVERY_ENV_MASTER || wasPopupShown()) {
      return;
    }
    // Yield to the app-download campaign popup — it can now land on signed-in
    // visitors too, and two stacked popups on the home page is worse than
    // deferring the order-mode choice to the next load. "pending" yields for
    // the same reason.
    if (appDownload !== "ineligible") return;
    // Only confirm the popup once we know delivery is actually switched on, so
    // we never offer a "choose delivery" prompt for a disabled service.
    // `visible` starts false and is only ever flipped true here, so there's no
    // synchronous setState in the effect body.
    let cancelled = false;
    fetch("/api/store-status", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { deliveryEnabled?: boolean } | null) => {
        if (cancelled) return;
        if (data?.deliveryEnabled !== false && !wasPopupShown()) {
          setVisible(true);
        }
      })
      .catch(() => {
        /* network blip — just don't show the popup this session */
      });
    return () => {
      cancelled = true;
    };
  }, [loading, profile, appDownload]);

  if (!visible) return null;

  function dismiss() {
    markPopupShown();
    setVisible(false);
  }

  function choose(mode: FulfillmentType) {
    setPreferredFulfillment(mode);
    dismiss();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={dismiss}
    >
      <div
        className="relative w-full max-w-sm overflow-hidden rounded-3xl shadow-2xl"
        style={{ backgroundColor: "#FFFDF8" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button
          onClick={dismiss}
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/30 text-white transition hover:bg-black/45"
          aria-label="Close"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        {/* Poster */}
        <Image
          src="/image/order-mode.webp"
          alt="Order for pick-up or delivery"
          width={2752}
          height={1536}
          sizes="(max-width: 640px) 100vw, 384px"
          className="h-auto w-full object-cover"
          priority
        />

        {/* Body */}
        <div className="px-6 pb-6 pt-5">
          <h2 className="text-center font-serif text-[24px] leading-tight tracking-tight text-[#2A1E14]">
            How would you like your order?
          </h2>
          <p className="mt-1.5 text-center text-[13px] text-[#6B5440]">
            Pick one — you can still change it at checkout.
          </p>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <button
              onClick={() => choose("PICKUP")}
              className="inline-flex items-center justify-center rounded-full border-2 px-4 py-3 text-sm font-semibold transition hover:bg-black/[0.03]"
              style={{ borderColor: BRAND.primaryColor, color: BRAND.primaryColor }}
            >
              Pick-up
            </button>
            <button
              onClick={() => choose("DELIVERY")}
              className="inline-flex items-center justify-center rounded-full px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90"
              style={{ backgroundColor: BRAND.primaryColor }}
            >
              Deliver
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
