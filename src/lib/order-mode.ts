import { isDeliveryEligible } from "./delivery-fee";
import type { FulfillmentType } from "@/components/checkout/FulfillmentSelector";

// Session-scoped order-mode preference, set from the home page popup and read
// as the Checkout fulfillment default. Stored in sessionStorage so it resets
// each browser session (the popup asks again next session). All accessors are
// SSR-safe — they no-op when `window` is undefined.

const PREFERRED_KEY = "mandys:orderMode:preferred";
const POPUP_SHOWN_KEY = "mandys:orderMode:popupShown";

function session(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function getPreferredFulfillment(): FulfillmentType | null {
  const raw = session()?.getItem(PREFERRED_KEY) ?? null;
  return raw === "PICKUP" || raw === "DELIVERY" ? raw : null;
}

export function setPreferredFulfillment(mode: FulfillmentType): void {
  session()?.setItem(PREFERRED_KEY, mode);
}

export function wasPopupShown(): boolean {
  return session()?.getItem(POPUP_SHOWN_KEY) === "1";
}

export function markPopupShown(): void {
  session()?.setItem(POPUP_SHOWN_KEY, "1");
}

// Resolve the Checkout default from the stored preference. DELIVERY is honored
// only when delivery is enabled AND the drinks subtotal meets the minimum order
// — otherwise (including no preference) we fall back to PICKUP.
export function resolveInitialFulfillment(
  preferred: FulfillmentType | null,
  drinksSubtotalCents: bigint,
  deliveryEnabled: boolean,
): FulfillmentType {
  if (
    preferred === "DELIVERY" &&
    deliveryEnabled &&
    isDeliveryEligible(drinksSubtotalCents)
  ) {
    return "DELIVERY";
  }
  return "PICKUP";
}
