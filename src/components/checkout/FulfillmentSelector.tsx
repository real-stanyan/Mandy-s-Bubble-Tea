"use client";

import { isDeliveryEligible } from "@/lib/delivery-fee";
import { DELIVERY } from "@/lib/constants";
import { formatPrice } from "@/lib/utils";

export type FulfillmentType = "PICKUP" | "DELIVERY";

const DELIVERY_ENV_MASTER = process.env.NEXT_PUBLIC_DELIVERY_ENABLED === "true";

/** "back at 5:00pm" beats an ISO timestamp for a customer, and beats "later
 *  today" for anyone deciding whether to wait. Brisbane is UTC+10 with no
 *  DST, the same offset trick lib/delivery-hours.ts uses — deliberately not
 *  Intl.DateTimeFormat, which differs between V8 and Hermes. */
export function deliveryMaintenanceCopy(untilIso: string): string {
  const ms = Date.parse(untilIso);
  if (!Number.isFinite(ms)) {
    return "Delivery is paused for system maintenance. Pickup is still open.";
  }
  const bne = new Date(ms + 10 * 60 * 60 * 1000);
  const h24 = bne.getUTCHours();
  const mins = bne.getUTCMinutes();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const clock = `${h12}:${String(mins).padStart(2, "0")}${h24 < 12 ? "am" : "pm"}`;
  return `Delivery is paused for system maintenance — back at ${clock} today. Pickup is still open.`;
}

type Props = {
  value: FulfillmentType;
  onChange: (next: FulfillmentType) => void;
  drinksSubtotalCents: bigint;
  // Live boss toggle (app_settings.delivery_enabled) from /api/store-status.
  // Defaults to enabled; ANDed with the build-time env master below. Omitting
  // it preserves the old env-only behaviour.
  deliveryEnabled?: boolean;
  /** Live pause from /api/store-status — why delivery is off and when it's
   *  back. Absent when delivery is off for any other reason. */
  deliveryPause?: { until: string; reason: string } | null;
};

export function FulfillmentSelector({
  value,
  onChange,
  drinksSubtotalCents,
  deliveryEnabled = true,
  deliveryPause = null,
}: Props) {
  const eligible = isDeliveryEligible(drinksSubtotalCents);
  const remainingCents = DELIVERY.minimumSubtotalCents - drinksSubtotalCents;
  const deliveryOn = DELIVERY_ENV_MASTER && deliveryEnabled;

  if (!deliveryOn) {
    // Pickup-only — rendered inside the page's Fulfillment card, so no border here.
    return (
      <div>
        <div className="flex items-start gap-3">
          <BagIcon className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
          <div>
            <div className="text-[15px] font-semibold text-ink">Pickup</div>
            <div className="mt-0.5 text-xs text-ink3">~10 min · 34 Davenport St</div>
          </div>
        </div>
        {/* Silence reads as broken. A named reason and a return time turn
            "no delivery today?" into information the customer can act on.

            text-ink2, not the #5A4330 literal it is by day: .bg-cream goes
            dark in Evening Mode, so a pinned dark ink would hide the one
            notice that explains why delivery is missing. */}
        {deliveryPause ? (
          <p className="mt-3 rounded-lg bg-cream px-3 py-2 text-xs text-ink2">
            {deliveryMaintenanceCopy(deliveryPause.until)}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      <FulfillmentButton
        active={value === "PICKUP"}
        onClick={() => onChange("PICKUP")}
        icon={<BagIcon className="h-[21px] w-[21px]" />}
        label="Pickup"
        sub="~10 min · 34 Davenport St"
      />
      <FulfillmentButton
        active={value === "DELIVERY"}
        disabled={!eligible}
        onClick={() => eligible && onChange("DELIVERY")}
        icon={<PinIcon className="h-[21px] w-[21px]" />}
        label="Delivery"
        sub={
          eligible
            ? `By our team · free over ${formatPrice(DELIVERY.tiers[0].freeAtCents)}`
            : `Add ${formatPrice(remainingCents)} to enable`
        }
      />
    </div>
  );
}

function FulfillmentButton({
  active,
  disabled,
  onClick,
  icon,
  label,
  sub,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex flex-col items-start gap-1.5 rounded-2xl px-4 py-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? "border-2 border-brand bg-cream"
          : "border border-line bg-card hover:border-ink4"
      }`}
    >
      <span className={active ? "text-brand" : "text-ink3"}>{icon}</span>
      <span
        className={`text-[15px] font-semibold ${active ? "text-brand" : "text-ink"}`}
      >
        {label}
      </span>
      <span className="text-[11.5px] text-ink3">{sub}</span>
    </button>
  );
}

function BagIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  );
}

function PinIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}
