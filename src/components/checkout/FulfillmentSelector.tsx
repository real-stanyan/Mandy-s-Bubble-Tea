"use client";

import { isDeliveryEligible } from "@/lib/delivery-fee";
import { DELIVERY } from "@/lib/constants";
import { formatPrice } from "@/lib/utils";

export type FulfillmentType = "PICKUP" | "DELIVERY";

const DELIVERY_ENABLED = process.env.NEXT_PUBLIC_DELIVERY_ENABLED === "true";

type Props = {
  value: FulfillmentType;
  onChange: (next: FulfillmentType) => void;
  drinksSubtotalCents: bigint;
};

export function FulfillmentSelector({ value, onChange, drinksSubtotalCents }: Props) {
  const eligible = isDeliveryEligible(drinksSubtotalCents);
  const remainingCents = DELIVERY.minimumSubtotalCents - drinksSubtotalCents;

  if (!DELIVERY_ENABLED) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm">
        <div className="font-medium">Pickup</div>
        <div className="text-xs text-zinc-600">34 Davenport St · Ready in ~10 min</div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      <button
        type="button"
        onClick={() => onChange("PICKUP")}
        className={`rounded-lg border px-4 py-3 text-center transition ${
          value === "PICKUP" ? "border-[#C43A10] bg-[#F5E6C8]" : "border-zinc-200 bg-white"
        }`}
      >
        <div className="font-semibold text-zinc-900">Pickup</div>
        <div className="mt-0.5 text-xs text-zinc-600">~10 min · 34 Davenport St</div>
      </button>

      <button
        type="button"
        disabled={!eligible}
        onClick={() => eligible && onChange("DELIVERY")}
        className={`rounded-lg border px-4 py-3 text-center transition disabled:cursor-not-allowed disabled:opacity-50 ${
          value === "DELIVERY" ? "border-[#C43A10] bg-[#F5E6C8]" : "border-zinc-200 bg-white"
        }`}
      >
        <div className="font-semibold text-zinc-900">Delivery</div>
        <div className="mt-0.5 text-xs text-zinc-600">
          {eligible
            ? `By our team · free over ${formatPrice(DELIVERY.tiers[0].freeAtCents)}`
            : `Add ${formatPrice(remainingCents)} to enable`}
        </div>
      </button>
    </div>
  );
}
