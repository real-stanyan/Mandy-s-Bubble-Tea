import type { FulfillmentType } from "@/components/checkout/FulfillmentSelector";

// Single source of truth for which promotions apply to which fulfillment mode.
// The new-customer Welcome discount (first 2 drinks 30% off) is a pickup-only
// perk — delivery orders neither receive it nor consume the customer's quota.
// IG-follow and loyalty rewards are intentionally not gated here.
export function welcomeDiscountEligible(fulfillment: FulfillmentType): boolean {
  return fulfillment === "PICKUP";
}
