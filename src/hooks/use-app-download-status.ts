"use client";

import { useEffect, useState } from "react";

// Client-side read of the app-download promo grant (the 20%-off ticket the
// campaign popup claims by phone). It deliberately does NOT ride /api/me:
// the grant is keyed by phone_e164, not by customer, and the route resolves
// it from the Supabase session — so a plain fetch is the whole contract.
//
// Display only. The discount is applied server-side in /api/orders, which
// prices it off authoritative catalog money. Two consumers: the checkout
// summary (show what the order will actually be charged) and the campaign
// popup (stop re-offering a ticket the visitor already holds).

export type AppDownloadStatus = {
  available: boolean;
  percentage: number;
  claimedAt: string | null;
  redeemedAt: string | null;
  /** True until the first response lands; false immediately when disabled. */
  loading: boolean;
};

const UNAVAILABLE = {
  available: false,
  percentage: 0,
  claimedAt: null,
  redeemedAt: null,
} as const;

/**
 * Whether this phone already holds — or has already spent — a grant.
 * `available` alone is not enough: it goes false again once redeemed, which
 * would otherwise read as "never claimed".
 */
export function hasAppDownloadGrant(s: AppDownloadStatus): boolean {
  return s.claimedAt != null || s.redeemedAt != null;
}

export function useAppDownloadStatus(enabled = true): AppDownloadStatus {
  const [status, setStatus] = useState<AppDownloadStatus>({
    ...UNAVAILABLE,
    loading: enabled,
  });
  useEffect(() => {
    if (!enabled) {
      setStatus({ ...UNAVAILABLE, loading: false });
      return;
    }
    let alive = true;
    setStatus((s) => ({ ...s, loading: true }));
    fetch("/api/promotions/app-download/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        if (!d?.ok) {
          setStatus({ ...UNAVAILABLE, loading: false });
          return;
        }
        setStatus({
          available: !!d.available,
          percentage: Number(d.percentage) || 0,
          claimedAt: d.claimedAt ?? null,
          redeemedAt: d.redeemedAt ?? null,
          loading: false,
        });
      })
      .catch(() => {
        // Signed out, offline, or the route errored — the server still applies
        // the real discount at order create; only this preview goes missing.
        if (alive) setStatus({ ...UNAVAILABLE, loading: false });
      });
    return () => {
      alive = false;
    };
  }, [enabled]);
  return status;
}
