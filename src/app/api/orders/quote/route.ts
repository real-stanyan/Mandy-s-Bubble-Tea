import { NextResponse } from "next/server";
import { squareClient, SQUARE_LOCATION_ID } from "@/lib/square";
import { getAuthedUser } from "@/lib/auth";
import { getMenu } from "@/lib/catalog";
import {
  buildAuthoritativePriceMaps,
  unknownVariationIds,
  STALE_CART_MESSAGE,
  type AuthoritativePriceMaps,
} from "@/lib/order-pricing";
import { dedupeLineModifiers } from "@/lib/order-modifiers";
import {
  buildSoldOutIndex,
  scanSoldOut,
  soldOutMessage,
  type SoldOutIndex,
} from "@/lib/sold-out";
import { reportDegraded } from "@/lib/degraded";
import { computeOrderPricing } from "@/lib/order-quote";
import { isValidQuoteBody } from "@/lib/order-request";
import { summarizeQuote } from "@/lib/order-quote-summary";

// Prices a cart WITHOUT creating anything — the checkout summary's single
// source of truth.
//
// Same body as `POST /api/orders`, same `computeOrderPricing()` call, then
// Square's own `orders.calculate` to total it. That last step is what makes
// this a quote rather than a fourth opinion: Square applies the service-charge
// percentages and rounds exactly as it will when the order is really created,
// so the number the customer reads here is the number they get charged.
//
// Read-only by construction — no order number is drawn, no Square order is
// written, no grant is claimed or burned. Safe to call on every render.
//
// Auth is required for a reason beyond privacy: welcome/IG/tier/app-download
// all resolve off the signed-in customer, so an anonymous quote could only
// ever be wrong. Signed-out checkout shows the plain cart subtotal instead.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!SQUARE_LOCATION_ID) {
    return NextResponse.json(
      { ok: false, error: "SQUARE_LOCATION_ID is not set on the server" },
      { status: 500 },
    );
  }

  const user = await getAuthedUser(request);
  if (!user?.profile?.square_customer_id || !user.profile.phone_e164) {
    return NextResponse.json(
      { ok: false, error: "Sign in to see your discounts" },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (!isValidQuoteBody(body)) {
    return NextResponse.json(
      { ok: false, error: "Missing or invalid fields" },
      { status: 400 },
    );
  }

  const customerId = user.profile.square_customer_id;
  const recipientPhone = user.profile.phone_e164;

  // Same catalog money the create route prices against. A menu-cache outage
  // leaves priceMaps null, which makes computeOrderPricing skip every discount
  // — the quote then under-promises, which is the safe direction to be wrong.
  //
  // Safe, but not harmless: the customer sees no promo at all and a total above
  // what they'd actually be charged, which reads as "my discount is gone" and
  // is a good reason to abandon the order. Worth knowing about, hence the alert.
  let priceMaps: AuthoritativePriceMaps | null = null;
  let soldOutIndex: SoldOutIndex | null = null;
  try {
    const menu = await getMenu();
    priceMaps = buildAuthoritativePriceMaps(menu);
    soldOutIndex = buildSoldOutIndex(menu);
  } catch (menuError) {
    priceMaps = null;
    soldOutIndex = null;
    reportDegraded("quote.menu-unavailable", { lineCount: body.lines.length }, menuError);
  }

  // Sold out is knowable right here, and used not to be checked until
  // /api/orders — i.e. until AFTER the wallet had been tokenized (#101). The
  // customer got a total, a live pay button, and then a refusal at the last
  // possible moment. Refuse to quote instead: the checkout page turns this into
  // a banner naming the drink, with the pay button off.
  if (soldOutIndex) {
    const soldOut = scanSoldOut(body.lines, soldOutIndex);
    if (soldOut.names.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: soldOutMessage(soldOut.names),
          soldOut: soldOut.names,
          soldOutLineIndexes: soldOut.lineIndexes,
        },
        { status: 409 },
      );
    }
  }

  // A cart line the catalog has never heard of prices at 0 (deliberately — see
  // unknownVariationIds), which would total the whole order at A$0.00 and read
  // as a free order. There is no honest number to send here, so send none: the
  // checkout pages fall back to their own cart subtotal, which is too high
  // rather than too low. Only meaningful when the menu actually loaded — a null
  // priceMaps is the separate, documented client-price fallback below.
  if (priceMaps) {
    const unknown = unknownVariationIds(body.lines, priceMaps);
    if (unknown.length > 0) {
      reportDegraded("quote.stale-cart", { unknown });
      return NextResponse.json(
        {
          ok: false,
          error: STALE_CART_MESSAGE,
          unknownVariationIds: unknown,
        },
        { status: 409 },
      );
    }
  }

  const isDelivery = body.fulfillmentType === "DELIVERY";
  // No address yet → no distance → no delivery fee. Everything else still prices.
  const delivery =
    body.delivery &&
    typeof body.delivery.lat === "number" &&
    typeof body.delivery.lng === "number"
      ? { lat: body.delivery.lat, lng: body.delivery.lng }
      : null;

  try {
    const pricing = await computeOrderPricing({
      lines: body.lines,
      applyWelcomeDiscount: body.applyWelcomeDiscount,
      applyIgFollowDiscount: body.applyIgFollowDiscount,
      applyLoyaltyReward: body.applyLoyaltyReward,
      loyaltyRewardCount: body.loyaltyRewardCount,
      isDelivery,
      delivery,
      customerId,
      recipientPhone,
      priceMaps,
    });

    // Ask Square to total it, exactly as it will at create time. A failure
    // here is not fatal — summarizeQuote falls back to computing the
    // percentage charges itself and flags the result as `estimated`.
    let calculated = null;
    try {
      const res = await squareClient.orders.calculate({
        order: {
          locationId: SQUARE_LOCATION_ID,
          customerId,
          lineItems: body.lines.map((line) => ({
            quantity: String(line.quantity),
            catalogObjectId: line.variationId,
            modifiers: dedupeLineModifiers(line.modifiers),
          })),
          discounts: pricing.discounts.length > 0 ? pricing.discounts : undefined,
          serviceCharges:
            pricing.serviceCharges.length > 0
              ? pricing.serviceCharges
              : undefined,
        },
      });
      calculated = res.order ?? null;
    } catch (calcError) {
      // summarizeQuote will flag the answer `estimated`. The customer still
      // gets a summary, so nothing here looks broken — which is exactly why it
      // has to be reported rather than logged.
      reportDegraded(
        "quote.square-calculate-failed",
        {
          lineCount: body.lines.length,
          discountCount: pricing.discounts.length,
          serviceChargeCount: pricing.serviceCharges.length,
        },
        calcError,
      );
    }

    return NextResponse.json({ ok: true, ...summarizeQuote(pricing, calculated) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
