import { DELIVERY } from "@/lib/constants";

/**
 * An "order can't be placed" gate surfaced as an actionable dialog rather
 * than a payment failure. These come from the delivery eligibility checks in
 * /api/orders (minimum order, hours, zone, missing address) — the order never
 * reached payment, so "Payment Failed / Retry" is both wrong and unhelpful.
 */
export type OrderBlock = {
  title: string;
  body: string;
  /** Offer "Add more items" (→ menu) — only useful for the minimum-order case. */
  canAddItems: boolean;
  /** Offer "Switch to pickup" — useful for every delivery-only gate. */
  canSwitchToPickup: boolean;
};

function dollars(cents: bigint, decimals: 0 | 2): string {
  return `$${(Number(cents) / 100).toFixed(decimals)}`;
}

/**
 * Classify a failed-order error message from /api/orders. Returns an
 * OrderBlock for the delivery eligibility gates (so checkout can show a
 * friendly, actionable dialog) or null for genuine payment failures (caller
 * falls back to PaymentErrorDialog). Matching is substring + case-insensitive
 * so it survives minor server-message wording changes.
 *
 * `subtotalCents` is the drinks subtotal, used to phrase the shortfall in the
 * minimum-order case.
 */
export function classifyOrderBlock(
  message: string | null | undefined,
  subtotalCents?: bigint,
): OrderBlock | null {
  if (!message) return null;
  const m = message.toLowerCase();

  if (m.includes("over 50 cups")) {
    // Matches BULK_TOO_LARGE_MESSAGE from /api/orders (bulk-order.ts): a
    // 50+ cup cart is arranged by a human, not a checkout.
    return {
      title: "That's a big order!",
      body: "Orders over 50 cups are arranged personally — tell Mandy in the chat, or ring the store on 0404 978 238, and Rick will be in touch to sort drinks, timing and a price.",
      canAddItems: false,
      canSwitchToPickup: false,
    };
  }

  if (m.includes("below minimum order")) {
    const min = DELIVERY.minimumSubtotalCents;
    const shortfall =
      subtotalCents !== undefined && subtotalCents < min
        ? min - subtotalCents
        : null;
    const minLabel = dollars(min, 0);
    return {
      title: "Can't place order",
      body: shortfall
        ? `You're ${dollars(shortfall, 2)} under the ${minLabel} delivery minimum. Add more items or switch to pickup.`
        : `This order is under the ${minLabel} delivery minimum. Add more items or switch to pickup.`,
      canAddItems: true,
      canSwitchToPickup: true,
    };
  }

  if (m.includes("delivery hours")) {
    return {
      title: "Delivery closed",
      body: "We're outside delivery hours right now. Switch to pickup, or try again later.",
      canAddItems: false,
      canSwitchToPickup: true,
    };
  }

  if (m.includes("delivery zone") || m.includes("postcode")) {
    return {
      title: "Outside delivery area",
      body: "That address is outside our delivery zone. Switch to pickup to keep your order.",
      canAddItems: false,
      canSwitchToPickup: true,
    };
  }

  if (m.includes("delivery details missing") || m.includes("delivery address")) {
    return {
      title: "Add a delivery address",
      body: "We need a delivery address before we can place this order.",
      canAddItems: false,
      canSwitchToPickup: true,
    };
  }

  return null;
}
