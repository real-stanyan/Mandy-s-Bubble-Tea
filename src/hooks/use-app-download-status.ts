"use client";

import { useEffect, useState } from "react";

// Client-side read of the app-download promo grant (the 20%-off ticket the
// campaign popup claims by phone). It deliberately does NOT ride /api/me:
// the grant is keyed by phone_e164, not by customer, and the route resolves
// it from the Supabase session — so a plain fetch is the whole contract.
//
// Display only. The discount is applied server-side in /api/orders, which
// prices it off authoritative catalog money; this exists so the checkout
// summary can show what the order will actually be charged.

export type AppDownloadStatus = {
  available: boolean;
  percentage: number;
};

const UNAVAILABLE: AppDownloadStatus = { available: false, percentage: 0 };

export function useAppDownloadStatus(enabled = true): AppDownloadStatus {
  const [status, setStatus] = useState<AppDownloadStatus>(UNAVAILABLE);
  useEffect(() => {
    if (!enabled) {
      setStatus(UNAVAILABLE);
      return;
    }
    let alive = true;
    fetch("/api/promotions/app-download/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.ok) return;
        setStatus({
          available: !!d.available,
          percentage: Number(d.percentage) || 0,
        });
      })
      .catch(() => {
        // Signed out, offline, or the route errored — the server still applies
        // the real discount at order create; only this preview goes missing.
      });
    return () => {
      alive = false;
    };
  }, [enabled]);
  return status;
}
