"use client";

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

      {otherCharges.map((sc) => (
        <div key={sc.uid} className="flex justify-between text-sm text-ink2">
          <span>{sc.name}</span>
          <span className="font-semibold text-ink">
            {formatPrice(BigInt(sc.amountCents))}
          </span>
        </div>
      ))}

      <div className="flex justify-between text-sm text-ink2">
        <span>Tax</span>
        <span className="font-semibold text-ink">Calculated at payment</span>
      </div>

      <div className="flex items-baseline justify-between border-t border-line pt-3">
        <span className="text-base font-bold text-ink">Total</span>
        <span className={`${totalSizeClassName} font-bold text-brand`}>
          {formatPrice(total)}
        </span>
      </div>
    </div>
  );
}
