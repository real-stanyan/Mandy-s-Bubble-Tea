import {
  BUSINESS,
  DELIVERY,
  DELIVERABLE_POSTCODES,
  LOYALTY,
  LOYALTY_CATEGORIES,
} from "@/lib/constants";
import { WEEKLY_SPECIALS } from "@/lib/menu/weekly-specials";

/** Decimal Brisbane hour → "10:30"-style label. */
function hourLabel(h: number): string {
  const whole = Math.floor(h);
  const minutes = Math.round((h - whole) * 60);
  return `${whole}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Store facts for the chat system prompt — the answers the assistant is
 * allowed to give to non-menu questions. Everything here is imported from
 * the same constants the rest of the site renders, so the assistant can
 * never drift from what the delivery form or the loyalty card shows.
 *
 * Deliberately does NOT state numeric prices or fees (delivery fee bands,
 * card surcharge): the chat's core invariant is that no price reaches the
 * customer except catalog-derived numbers printed by the app, and the fee
 * schedule is better answered by checkout itself, which computes the real
 * amount for the customer's actual address and subtotal.
 */
export function buildStoreDigest(
  /** A live delivery pause, so Mandy stops offering delivery the moment the
   *  shop pauses it. Without this she keeps promising a service the order
   *  API will refuse — the same "promised what we can't deliver" failure
   *  preference-check.ts exists to stop. */
  deliveryPause: { until: string; reason: string } | null = null,
): string {
  const specials = WEEKLY_SPECIALS.map((s) => s.name).join(", ");
  // While paused, the delivery facts are REPLACED, not annotated. A warning
  // line above "we deliver to 4211, 4214, …, daily 10:30–22:30" loses to the
  // concrete list every time — the model answered "yes, 4217 is in our
  // delivery area" with the warning right there in its own prompt
  // (2026-08-11). Contradictory context is worse than missing context.
  const deliveryFacts = deliveryPause
    ? [
        `- DELIVERY IS PAUSED RIGHT NOW (${deliveryPause.reason}) and cannot be ordered at all — not to any postcode, not at any time today until it resumes later today. There is no delivery area and no delivery hours while paused: the checkout will refuse a delivery order.`,
        `- Ordering: pickup at the store ONLY. If the customer asks about delivery, or names an address or postcode, tell them delivery is paused for system maintenance and will be back later today, and offer pickup. Never say a postcode is in range, never quote delivery hours or fees.`,
      ]
    : [
        `- Ordering: pickup at the store, or delivery to postcodes ${DELIVERABLE_POSTCODES.join(", ")} (minimum order applies; the delivery fee depends on distance and order size and is shown at checkout).`,
        `- Delivery hours: ${hourLabel(DELIVERY.hoursOpen)}–${hourLabel(DELIVERY.hoursClose)} Brisbane time daily.`,
      ];
  return `STORE FACTS
- Store: ${BUSINESS.name}, ${BUSINESS.address}. Phone ${BUSINESS.phone}. Website ${BUSINESS.domain}.
${deliveryFacts.join("\n")}
- Loyalty: buy drinks from the ${LOYALTY_CATEGORIES.join("/")} categories to earn 1 star each; ${LOYALTY.starsPerReward} stars = ${LOYALTY.rewardLabel}. Stars and rewards are used at checkout.
- This week's specials (discounted on the menu): ${specials || "none right now"}.
- Anything not stated here (exact fees, store opening hours, stock tomorrow): say you are not sure and point the customer at the menu, the checkout page, or the store phone. Never guess.`;
}
