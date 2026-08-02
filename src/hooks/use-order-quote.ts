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

/**
 * The quote failures the customer has to be told about.
 *
 * Every other failure is safe to swallow — signed out, Square slow, network
 * blip — because the page falls back to the cart's own subtotal, which is too
 * high rather than too low, and the order still goes through. These two are
 * different: the server has refused to price the cart (409), and the create
 * route will refuse it too. Falling back silently shows a plausible total for
 * an order that cannot be placed, and the customer has no way to work out why.
 *
 * "stale-cart" (#84) = the line has no catalog entry at all, usually an item
 * deleted and re-added in Square while it sat in a persisted cart. Gone for
 * good under that id.
 *
 * "sold-out" (#101) = the catalog knows it and says not today. Comes back on
 * its own, which is why the server's wording differs and why we render the
 * server's string rather than one of our own.
 */
export type QuoteBlocked = {
  reason: "stale-cart" | "sold-out";
  message: string;
  /** Stale-cart only: which variations the catalog no longer has. */
  variationIds: string[];
  /** Sold-out only: names of the drinks/toppings that are out. */
  soldOut: string[];
};

/**
 * What a quote response means for what's on screen. Split out of the hook so
 * the three-way decision is testable without rendering: it is the part with
 * actual rules in it, and getting the "ignore" case wrong is invisible.
 */
export type QuoteOutcome =
  | { kind: "quote"; quote: OrderQuote }
  | { kind: "blocked"; blocked: QuoteBlocked }
  | { kind: "ignore" };

export function interpretQuoteResponse(
  status: number,
  json: unknown,
): QuoteOutcome {
  const body = (json ?? {}) as Record<string, unknown>;
  if (body.ok) return { kind: "quote", quote: json as OrderQuote };
  if (status === 409 && Array.isArray(body.unknownVariationIds)) {
    return {
      kind: "blocked",
      blocked: {
        reason: "stale-cart",
        message:
          typeof body.error === "string"
            ? body.error
            : "Some items in your cart are no longer on the menu.",
        variationIds: body.unknownVariationIds as string[],
        soldOut: [],
      },
    };
  }
  if (status === 409 && Array.isArray(body.soldOut)) {
    return {
      kind: "blocked",
      blocked: {
        reason: "sold-out",
        // The server names the drink and says what to do about it; inventing a
        // generic line here would throw that away.
        message:
          typeof body.error === "string"
            ? body.error
            : "Something in your cart just sold out.",
        variationIds: [],
        soldOut: body.soldOut as string[],
      },
    };
  }
  // Everything else — 401 signed out, 502 Square down, a network blip — keeps
  // whatever is already on screen. Those all still let the order through.
  return { kind: "ignore" };
}

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
): { quote: OrderQuote | null; loading: boolean; blocked: QuoteBlocked | null } {
  const [quote, setQuote] = useState<OrderQuote | null>(null);
  const [blocked, setBlocked] = useState<QuoteBlocked | null>(null);
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
        .then(async (r) => ({ status: r.status, json: await r.json() }))
        .then(({ status, json }) => {
          if (controller.signal.aborted) return;
          // Only a successful quote replaces the visible one — that IS the
          // stale-while-revalidate behaviour, no extra bookkeeping. A failed
          // quote (signed out, Square down) leaves the previous one up; the
          // page falls back to the plain subtotal when there has never been one.
          const outcome = interpretQuoteResponse(status, json);
          if (outcome.kind === "quote") {
            setQuote(outcome.quote);
            setBlocked(null);
          } else if (outcome.kind === "blocked") {
            // Drop the old quote as well as flagging it. It was priced for a
            // cart that no longer exists, and leaving it up would keep a
            // believable total on screen under the warning saying not to
            // believe it.
            setQuote(null);
            setBlocked(outcome.blocked);
          }
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
  return {
    quote: key ? quote : null,
    loading: key ? loading : false,
    blocked: key ? blocked : null,
  };
}
