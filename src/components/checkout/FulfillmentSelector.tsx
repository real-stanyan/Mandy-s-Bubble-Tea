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
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-zinc-900">How would you like it?</h3>

      <button
        type="button"
        onClick={() => onChange("PICKUP")}
        className={`w-full rounded-lg border px-4 py-3 text-left transition ${
          value === "PICKUP" ? "border-[#C43A10] bg-[#F5E6C8]" : "border-zinc-200"
        }`}
      >
        <div className="font-medium">Pickup</div>
        <div className="text-xs text-zinc-600">34 Davenport St · Ready in ~10 min</div>
      </button>

      <button
        type="button"
        disabled={!eligible}
        onClick={() => eligible && onChange("DELIVERY")}
        className={`w-full rounded-lg border px-4 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
          value === "DELIVERY" ? "border-[#C43A10] bg-[#F5E6C8]" : "border-zinc-200"
        }`}
      >
        <div className="font-medium">Delivery</div>
        <div className="text-xs text-zinc-600">
          {eligible
            ? `From $${(Number(DELIVERY.feeCents) / 100).toFixed(2)} · ~25 min · FREE over $${(Number(DELIVERY.feeFreeAtSubtotalCents) / 100).toFixed(0)}`
            : `Add ${formatPrice(remainingCents)} to enable delivery`}
        </div>
      </button>
    </div>
  );
}
