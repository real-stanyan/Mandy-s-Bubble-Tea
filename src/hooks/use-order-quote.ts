"use client";

import { useEffect, useState } from "react";

// Asks the server what this cart costs. The answer replaces what the checkout
// page used to work out for itself — welcome/IG/tier/flash/app-download and the
// percentage surcharges are all decided in one place now (see
// src/lib/order-quote.ts and docs/adr/0005). Rendering a quote instead of a
// local re-derivation is what closes web #73 / app#40: a promo the client has
// never heard of still shows up, because the client isn't the one deciding.
//
// Stale-while-revalidate: while a refetch is in flight the previous quote stays
// on screen. Blanking the summary on every reward-count tap would be worse than
// briefly showing the old number, and the charged amount never comes from here
// anyway — it comes from the created order's own total.

export type QuoteAmount = {
  uid: string;
  name: string;
  amountCents: string;
  /** Display-only aside, e.g. the Diamond allowance's "3 left this month". */
  note?: string;
};

export type OrderQuote = {
  subtotalCents: string;
  discounts: QuoteAmount[];
  serviceCharges: QuoteAmount[];
  discountTotalCents: string;
  serviceChargeTotalCents: string;
  rewardCupsSumCents: string;
  totalCents: string;
  netTotalCents: string;
  estimated: boolean;
};

const DEBOUNCE_MS = 250;

export function useOrderQuote(
  body: unknown | null,
  enabled: boolean,
  /**
   * Any extra value that should force a refetch without being part of the
   * request. The public-holiday flag uses it: crossing midnight changes the
   * surcharge but not the cart, so nothing in the body would move.
   */
  refreshKey: string | number | boolean = "",
): { quote: OrderQuote | null; loading: boolean } {
  const [quote, setQuote] = useState<OrderQuote | null>(null);
  const [loading, setLoading] = useState(false);
  // The serialized body doubles as the effect key: a re-render that produces an
  // identical cart must not refetch. `null` means "nothing to price".
  const key = enabled && body ? JSON.stringify(body) : null;
  const effectKey = key === null ? null : `${key}|${refreshKey}`;

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      fetch("/api/orders/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: key,
        signal: controller.signal,
      })
        .then((r) => r.json())
        .then((json) => {
          if (controller.signal.aborted) return;
          // Only a successful quote replaces the visible one — that IS the
          // stale-while-revalidate behaviour, no extra bookkeeping. A failed
          // quote (signed out, Square down) leaves the previous one up; the
          // page falls back to the plain subtotal when there has never been one.
          if (json?.ok) setQuote(json as OrderQuote);
          setLoading(false);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // Both, though effectKey already contains key: React compares the array as
    // a whole, so the extra entry can never cause a second fetch.
  }, [key, effectKey]);

  // An emptied cart drops the quote without a state write during render.
  return { quote: key ? quote : null, loading: key ? loading : false };
}
