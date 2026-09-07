"use client";

import { useState } from "react";
import { formatPrice } from "@/lib/utils";
import { BRAND, DELIVERY_FEE_NAME } from "@/lib/constants";
import type { OrderQuote } from "@/hooks/use-order-quote";

// The money half of the order summary, rendered from the server's quote.
//
// Every discount and fee line comes straight out of `/api/orders/quote` —
// including its name, which the server formats because only the server knows
// how many drinks a promo covered or which promo won the exclusive better-of.
// Nothing here decides anything; adding a promo server-side makes it appear
// on both checkout summaries with no client change (web #73, app#40).
//
// Used by BOTH the mobile and desktop summaries. They used to be two hand-kept
// copies, and had already drifted: the desktop one never learned about flash or
// app-download and still printed a Welcome line that the server had replaced.

const DELIVERY_UIDS = new Set(["delivery-fee", "service-fee"]);

export function OrderSummaryTotals({
  subtotalCents,
  quote,
  fulfillment,
  rewardCount,
  deliveryQuotePending,
  totalSizeClassName = "text-xl",
}: {
  /** Local cart subtotal — shown only until the first quote lands. */
  subtotalCents: bigint;
  quote: OrderQuote | null;
  fulfillment: "PICKUP" | "DELIVERY";
  rewardCount: number;
  /** Delivery chosen but the address quote hasn't resolved yet. */
  deliveryQuotePending: boolean;
  totalSizeClassName?: string;
}) {
  const subtotal = quote ? BigInt(quote.subtotalCents) : subtotalCents;
  const rewardCents = quote ? BigInt(quote.rewardCupsSumCents) : 0n;
  // No quote yet: show the bare subtotal rather than a total we'd have to
  // invent. It settles within a few hundred ms of the page opening.
  const total = quote ? BigInt(quote.netTotalCents) : subtotalCents;

  const chargeByUid = new Map(
    (quote?.serviceCharges ?? []).map((sc) => [sc.uid, sc]),
  );
  const deliveryFee = chargeByUid.get("delivery-fee");
  const serviceFee = chargeByUid.get("service-fee");
  const otherCharges = (quote?.serviceCharges ?? []).filter(
    (sc) => !DELIVERY_UIDS.has(sc.uid),
  );

  return (
    <div className="space-y-3">
      <div className="flex justify-between text-sm text-ink2">
        <span>Subtotal</span>
        <span className="font-semibold text-ink">{formatPrice(subtotal)}</span>
      </div>

      {(quote?.discounts ?? []).map((d) => (
        <div key={d.uid} className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: BRAND.primaryColor }}
            />
            {d.name}
            {d.note && <span className="text-ink3">({d.note})</span>}
          </span>
          <span style={{ color: BRAND.primaryColor }}>
            −{formatPrice(BigInt(d.amountCents))}
          </span>
        </div>
      ))}

      {rewardCount > 0 && (
        <div className="flex justify-between text-sm">
          <span className="font-semibold" style={{ color: BRAND.primaryColor }}>
            Loyalty reward{rewardCount > 1 ? ` ×${rewardCount}` : ""}
          </span>
          <span className="font-semibold" style={{ color: BRAND.primaryColor }}>
            −{formatPrice(rewardCents)}
          </span>
        </div>
      )}

      {fulfillment === "DELIVERY" && (
        <>
          <div className="flex justify-between text-sm text-ink2">
            <span>{DELIVERY_FEE_NAME}</span>
            <span className="font-semibold text-ink">
              {/* A zero fee is attached as no charge at all, so "no row" means
                  free — but only once a quote actually exists. Before that it's
                  unknown, and "FREE" would be a promise we can't keep. */}
              {deliveryQuotePending || !quote ? (
                <span className="text-ink4">—</span>
              ) : deliveryFee ? (
                formatPrice(BigInt(deliveryFee.amountCents))
              ) : (
                <span className="text-emerald-600">FREE</span>
              )}
            </span>
          </div>
          <div className="flex justify-between text-sm text-ink2">
            <span>{serviceFee?.name ?? "Service Fee"}</span>
            <span className="font-semibold text-ink">
              {deliveryQuotePending || !quote ? (
                <span className="text-ink4">—</span>
              ) : (
                formatPrice(BigInt(serviceFee?.amountCents ?? "0"))
              )}
            </span>
          </div>
        </>
      )}

      {otherCharges.length > 0 ? (
        <FeesAndTax charges={otherCharges} />
      ) : (
        <TaxRow />
      )}

      <div className="flex items-baseline justify-between border-t border-line pt-3">
        <span className="text-base font-bold text-ink">Total</span>
        <span className={`${totalSizeClassName} font-bold text-brand`}>
          {formatPrice(total)}
        </span>
      </div>
    </div>
  );
}

/** The static disclaimer, not a number: there is no tax field on the quote —
 *  Square works the tax out when the order is created, so the summary can only
 *  promise that it will. */
function TaxRow({ indented = false }: { indented?: boolean }) {
  return (
    <div
      className={`flex justify-between text-sm text-ink2 ${indented ? "pl-3" : ""}`}
    >
      <span>Tax</span>
      <span className={indented ? "text-ink2" : "font-semibold text-ink"}>
        Calculated at payment
      </span>
    </div>
  );
}

/**
 * Platform Fee, Card Surcharge and the tax note, behind one row.
 *
 * Three pass-through lines sat between the discounts (which are the good news)
 * and the Total (which is the answer), and each one is a couple of cents the
 * customer cannot do anything about (#371). Folded they are one row; the money
 * they add is still on it, so nothing about the Total becomes unexplained.
 *
 * The collapsed value says "+ tax" on purpose. Tax is not in the sum — it is
 * not in the Total either — so a fold that hid the note would let a customer
 * read $4.03 and be charged more with no warning anywhere on the page.
 *
 * State-backed `open` rather than the bare attribute: the quote poll
 * re-renders this component every few seconds (stale-while-revalidate in
 * use-order-quote), and an uncontrolled <details> would snap shut under it.
 */
function FeesAndTax({
  charges,
}: {
  charges: { uid: string; name: string; amountCents: string }[];
}) {
  const [open, setOpen] = useState(false);
  const sum = charges.reduce((n, sc) => n + BigInt(sc.amountCents), 0n);

  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm text-ink2 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-1.5">
          Fees &amp; tax
          {/* The arrow is a different path when open, not the same path
              rotated. `rotate-180` does not take on this element — measured
              in the browser, with the class present and the selector
              matching it still computes `rotate: 0deg`, while a bare
              `rotate-180` sibling in the same slot gives 180deg. Whatever
              that interaction is, swapping the points sidesteps it. */}
          <Chevron up={open} className="h-3.5 w-3.5 text-ink4" />
        </span>
        <span className="font-semibold text-ink">
          {formatPrice(sum)} <span className="font-normal text-ink3">+ tax</span>
        </span>
      </summary>
      <div className="mt-3 space-y-3">
        {charges.map((sc) => (
          <div key={sc.uid} className="flex justify-between pl-3 text-sm text-ink2">
            <span>{sc.name}</span>
            <span>{formatPrice(BigInt(sc.amountCents))}</span>
          </div>
        ))}
        <TaxRow indented />
      </div>
    </details>
  );
}

function Chevron({ up = false, className }: { up?: boolean; className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <polyline points={up ? "6 15 12 9 18 15" : "6 9 12 15 18 9"} />
    </svg>
  );
}
