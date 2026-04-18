"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BRAND } from "@/lib/constants";
import { useAuth } from "@/components/auth/AuthProvider";

const DISMISS_KEY = "mbt:welcome-discount:dismissed";

export function WelcomeDiscountBanner() {
  const { welcomeDiscount } = useAuth();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(DISMISS_KEY)) setDismissed(true);
    } catch {
      // ignore — SSR or storage unavailable
    }
  }, []);

  if (dismissed || !welcomeDiscount.available) return null;

  const percentage = welcomeDiscount.percentage || 30;

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
            setDismissed(true);
          }}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25"
        >
          ×
        </button>
      </div>
    </div>
  );
}
