"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BRAND } from "@/lib/constants";

const DISMISS_KEY = "mbt:welcome-discount:dismissed";
const PHONE_KEY = "mbt:account:phone";

export function WelcomeDiscountBanner() {
  const [visible, setVisible] = useState(false);
  const [percentage, setPercentage] = useState(30);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (sessionStorage.getItem(DISMISS_KEY)) return;
        const phone = localStorage.getItem(PHONE_KEY);
        if (!phone) return;

        // Resolve phone → customerId via the lookup endpoint.
        const lookupRes = await fetch("/api/customer/lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone }),
        });
        const lookup = await lookupRes.json();
        if (!lookup?.found || !lookup?.customerId) return;

        const statusRes = await fetch(
          `/api/welcome-discount/status?customerId=${encodeURIComponent(lookup.customerId)}`,
        );
        const status = await statusRes.json();
        if (cancelled) return;
        if (status?.available) {
          setPercentage(status.percentage ?? 30);
          setVisible(true);
        }
      } catch {
        // Silent — banner is purely promotional.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      className="relative mx-auto mt-3 flex w-full max-w-6xl items-center justify-between gap-3 rounded-2xl px-5 py-4 text-white shadow-sm sm:px-6 sm:py-5"
      style={{ backgroundColor: BRAND.primaryColor }}
      role="status"
    >
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-widest opacity-90">
          Your Welcome Gift
        </p>
        <p className="mt-0.5 text-sm font-semibold sm:text-base">
          {percentage}% off your first order — auto-applied at checkout
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Link
          href="/menu"
          className="shrink-0 rounded-full bg-white px-4 py-2 text-xs font-semibold sm:text-sm"
          style={{ color: BRAND.primaryColor }}
        >
          Order Now
        </Link>
        <button
          type="button"
          aria-label="Dismiss welcome discount banner"
          onClick={() => {
            try {
              sessionStorage.setItem(DISMISS_KEY, "1");
            } catch {
              // ignore
            }
            setVisible(false);
          }}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25"
        >
          ×
        </button>
      </div>
    </div>
  );
}
