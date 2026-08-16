// The wire shape of an online-order request, and the only validator for it.
//
// Shared because `POST /api/orders` (create) and `POST /api/orders/quote`
// (price it without creating anything) accept the SAME body — the quote is
// only trustworthy if it prices exactly what the create call would receive.
// One type, one validator, so the two can never drift.

export type ClientLineModifier = {
  id: string;
  name?: string;
  /** Modifier upcharge in cents. 0 for included/free modifiers. */
  priceCents: number;
};

export type ClientLine = {
  itemName: string;
  variationId: string;
  variationName?: string;
  /** Variation base price in cents (excluding modifiers). */
  variationPriceCents: number;
  modifiers: ClientLineModifier[];
  quantity: number;
};

export type OrderRequestBody = {
  lines: ClientLine[];
  note?: string;
  applyWelcomeDiscount?: boolean;
  applyIgFollowDiscount?: boolean;
  /** Store-wide one-day flash promo. Accepted for forward-compat but the
   *  server auto-applies the promo whenever one is active — old app
   *  binaries that never send this still get the discount. */
  applyFlashPromo?: boolean;
  /** Client signals a loyalty reward will fully cover the order. When
   *  true we skip the card surcharge because no card is charged
   *  (payment amount is $0 after reward redemption). Trusted the same
   *  way applyWelcomeDiscount is — abuse risk is ~1.9% per order, same
   *  order of magnitude as welcome-discount gaming. */
  applyLoyaltyReward?: boolean;
  fulfillmentType?: "PICKUP" | "DELIVERY";
  delivery?: {
    address: string;
    lat: number;
    lng: number;
    unit?: string;
    driverNote?: string;
    postcode?: string;
  };
  /** Number of loyalty rewards the client wants applied to this order.
   *  Must be a non-negative integer (fractional values are floored by
   *  pickPromoCups). When > 0, gates skipSurcharges on its own —
   *  applyLoyaltyReward boolean above is the legacy field for old app
   *  binaries that don't send this count. When the order ALSO has a
   *  welcome/IG discount, pickPromoCups uses this to remove the cheapest
   *  N cups from the discount candidate set so server agrees with client
   *  on which cups belong to rewards vs promos. (When neither welcome
   *  nor IG discount is active on this order, pickPromoCups isn't called
   *  and this field only affects skipSurcharges.) */
  loyaltyRewardCount?: number;
  /** Client-supplied idempotency token (stable per checkout attempt). Used to
   *  dedupe order creation so a retry of the same order doesn't make a second
   *  order + charge. Namespaced by customer server-side before hitting Square. */
  idempotencyKey?: string;
  /** Scheduled pickup: minutes from now until collection. 0/absent = ASAP.
   *  Only the fixed pills (see pickup-schedule.ts) validate, and only for
   *  PICKUP — a delivery order's timing belongs to the driver, not a pill.
   *  The route re-checks the value against the closing time server-side;
   *  this validator only guards the shape. */
  pickupOffsetMinutes?: number;
};

export function isValidOrderBody(body: unknown): body is OrderRequestBody {
  if (!body || typeof body !== "object") return false;
  const b = body as Partial<OrderRequestBody>;
  if (b.idempotencyKey !== undefined && typeof b.idempotencyKey !== "string") {
    return false;
  }
  if (
    b.pickupOffsetMinutes !== undefined &&
    (typeof b.pickupOffsetMinutes !== "number" ||
      !Number.isInteger(b.pickupOffsetMinutes) ||
      b.pickupOffsetMinutes < 0)
  ) {
    return false;
  }
  if (!Array.isArray(b.lines) || b.lines.length === 0) return false;
  return b.lines.every((line) => {
    if (!line || typeof line !== "object") return false;
    if (typeof line.variationId !== "string") return false;
    if (typeof line.variationPriceCents !== "number") return false;
    if (typeof line.quantity !== "number" || line.quantity < 1) return false;
    if (!Array.isArray(line.modifiers)) return false;
    return line.modifiers.every(
      (m) =>
        m &&
        typeof m.id === "string" &&
        typeof m.priceCents === "number",
    );
  }) && (() => {
    if (b.fulfillmentType === "DELIVERY") {
      if (!b.delivery || typeof b.delivery !== "object") return false;
      const d = b.delivery;
      if (typeof d.address !== "string" || d.address.length < 3) return false;
      if (typeof d.lat !== "number" || typeof d.lng !== "number") return false;
    }
    return true;
  })();
}

/**
 * Same body, minus the delivery-details requirement.
 *
 * The checkout page asks for a quote the moment DELIVERY is picked — before an
 * address exists. Rejecting that would leave the summary showing pickup prices
 * (the welcome discount is pickup-only) until the address is typed, and then
 * silently drop it. Pricing it as a delivery order with no address yet is the
 * honest answer: the promos are right, the delivery fee is simply not sized
 * until there's somewhere to drive to.
 */
export function isValidQuoteBody(body: unknown): body is OrderRequestBody {
  if (!body || typeof body !== "object") return false;
  const b = body as Partial<OrderRequestBody>;
  if (!Array.isArray(b.lines) || b.lines.length === 0) return false;
  return b.lines.every((line) => {
    if (!line || typeof line !== "object") return false;
    if (typeof line.variationId !== "string") return false;
    if (typeof line.variationPriceCents !== "number") return false;
    if (typeof line.quantity !== "number" || line.quantity < 1) return false;
    if (!Array.isArray(line.modifiers)) return false;
    return line.modifiers.every(
      (m) => m && typeof m.id === "string" && typeof m.priceCents === "number",
    );
  });
}
