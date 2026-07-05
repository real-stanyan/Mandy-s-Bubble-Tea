import type { ClientPlatform } from "@/lib/client-platform";

// Builders + header sanitizers for the Square order `metadata` block.
//
// Square caps order metadata at ~10 entries per order, so every new key has
// to be budgeted. Worst case today (delivery + IG discount + tier toppings +
// app_client) is exactly 10 — order-metadata.test.ts pins that invariant so
// the next key added here fails a test instead of a production order create.
// (Welcome discount is pickup-only, so it can never stack on the delivery
// worst case.)

/** `x-mbt-app-version` — e.g. "1.1.4+22". Free-form header from the app; only
 *  a conservative charset/length is accepted, anything else → null. */
export function sanitizeAppVersion(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return /^[0-9A-Za-z.+()-]{1,32}$/.test(raw) ? raw : null;
}

/** `x-mbt-platform` — whitelist, anything unexpected → null. */
export function sanitizeAppPlatform(raw: string | null | undefined): "ios" | "android" | null {
  return raw === "ios" || raw === "android" ? raw : null;
}

export type OrderMetadataInput = {
  clientPlatform: ClientPlatform;
  /** Already sanitized (sanitizeAppVersion). */
  appVersion: string | null;
  /** Already sanitized (sanitizeAppPlatform). */
  appPlatform: "ios" | "android" | null;
  cartFingerprint: string;
  site: string;
  welcomeDrinksCovered: number;
  igFollowDrinksCovered: number;
  tierToppingsCovered: number;
  delivery: { address: string; lat: number; lng: number } | null;
};

export function buildOrderMetadata(input: OrderMetadataInput): Record<string, string> {
  return {
    // web | app — derived from X-Client-Platform header / User-Agent.
    // Pre-2026-06 orders all read "web" (this field was hard-coded).
    source: input.clientPlatform,
    site: input.site,
    // Cart fingerprint for the server-side duplicate-order backstop.
    cart_hash: input.cartFingerprint,
    // Which shipped binary placed this order, e.g. "ios/1.1.4+22" — a single
    // entry (platform + version fused) to stay inside the metadata budget.
    // Only stamped for app orders that actually sent a valid version header.
    ...(input.clientPlatform === "app" && input.appVersion
      ? { app_client: `${input.appPlatform ?? "?"}/${input.appVersion}` }
      : {}),
    ...(input.welcomeDrinksCovered > 0
      ? { welcomeDiscountDrinksCovered: String(input.welcomeDrinksCovered) }
      : {}),
    ...(input.delivery
      ? {
          // Mandy's own admin / forecast / fee accounting read this to
          // know the order is a delivery even though Square sees a pickup.
          fulfillment_type: "DELIVERY",
          delivery_address: input.delivery.address,
          delivery_lat: String(input.delivery.lat),
          delivery_lng: String(input.delivery.lng),
        }
      : {}),
    ...(input.igFollowDrinksCovered > 0
      ? { igFollowDiscountDrinksCovered: String(input.igFollowDrinksCovered) }
      : {}),
    ...(input.tierToppingsCovered > 0
      ? { tierToppingsCovered: String(input.tierToppingsCovered) }
      : {}),
  };
}
