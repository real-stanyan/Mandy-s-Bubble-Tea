import { NextResponse } from "next/server";
import { deriveOrderIdempotencyKey } from "@/lib/order-idempotency";
import { cartHash, pickDuplicateOrder } from "@/lib/order-dedup";
import { squareClient, SQUARE_LOCATION_ID } from "@/lib/square";
import { BUSINESS } from "@/lib/constants";
import { getEffectiveOrderingStatus, isDeliveryEnabled } from "@/lib/store-status-server";
import { serializeSquareResponse } from "@/lib/utils";
import { clientPlatformFrom } from "@/lib/client-platform";
import {
  buildOrderMetadata,
  sanitizeAppPlatform,
  sanitizeAppVersion,
} from "@/lib/order-metadata";
import { nextOnlineOrderNumber } from "@/lib/supabase";
import { getAuthedUser } from "@/lib/auth";
import { getMenu } from "@/lib/catalog";
import {
  buildAuthoritativePriceMaps,
  unknownVariationIds,
  STALE_CART_MESSAGE,
  type AuthoritativePriceMaps,
} from "@/lib/order-pricing";
import { dedupeLineModifiers } from "@/lib/order-modifiers";
import { reportDegraded } from "@/lib/degraded";
import { isDeliveryEligible } from "@/lib/delivery-fee";
import { isDeliveryHoursOpen } from "@/lib/delivery-hours";
import { isDeliverablePostcode } from "@/lib/delivery-zone";
import { deliveryFulfillmentNote } from "@/lib/delivery-ticket";
import { computeOrderPricing, drinksSubtotalFor } from "@/lib/order-quote";
import { isValidOrderBody } from "@/lib/order-request";

// Creates a Square order from the client cart. Identity is derived
// entirely from the Supabase session — the client does NOT send a
// customerId or phone. Prices are trusted to Square via
// catalogObjectId references so Square recomputes pricing against the
// current catalog. This also means tax/loyalty rules configured in the
// Square Dashboard apply automatically.

export async function POST(request: Request) {
  if (!SQUARE_LOCATION_ID) {
    return NextResponse.json(
      { ok: false, error: "SQUARE_LOCATION_ID is not set on the server" },
      { status: 500 },
    );
  }

  // Which client placed this order — the native app or the web site. Both
  // POST here through the same Square OAuth app, so this header/UA check is
  // the only thing that can tell them apart. Stamped into metadata.source.
  const clientPlatform = clientPlatformFrom(
    request.headers.get("x-client-platform"),
    request.headers.get("user-agent"),
  );
  // Which shipped app binary (e.g. "1.1.4+22" / "ios") — stamped into order
  // metadata as a single app_client entry so payment failures can be
  // attributed to a specific build. Sanitized: garbage headers → null → no
  // metadata entry at all.
  const appVersion = sanitizeAppVersion(request.headers.get("x-mbt-app-version"));
  const appPlatform = sanitizeAppPlatform(request.headers.get("x-mbt-platform"));

  const user = await getAuthedUser(request);
  if (!user?.profile?.square_customer_id || !user.profile.phone_e164) {
    return NextResponse.json(
      { ok: false, error: "Sign in and complete your profile to place an order" },
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

  if (!isValidOrderBody(body)) {
    return NextResponse.json(
      { ok: false, error: "Missing or invalid fields" },
      { status: 400 },
    );
  }

  // Hard ordering-window guard. Brisbane 10:30am – 22:15pm. Server is
  // authoritative — clients place orders only when their cart UI says
  // open, but a stale tab / clock skew / direct API call could still
  // land here outside hours.
  const ordering = await getEffectiveOrderingStatus(new Date());
  if (!ordering.open) {
    return NextResponse.json(
      {
        ok: false,
        error: `Sorry, online orders are closed. ${ordering.nextLabel}.`,
        closed: true,
        nextLabel: ordering.nextLabel,
      },
      { status: 409 },
    );
  }

  for (const line of body.lines) {
    if (
      !line.variationId ||
      typeof line.quantity !== "number" ||
      line.quantity < 1
    ) {
      return NextResponse.json(
        { ok: false, error: "Invalid line item" },
        { status: 400 },
      );
    }
  }

  // Sold-out gate. Client UI already disables sold-out items/modifiers,
  // but an order can land here from a stale tab or parallel Square POS
  // edit. Reject before handing the order to Square so the customer sees
  // a clear error instead of paying for something the shop can't make.
  // Server-authoritative per-cup prices, built from the Square catalog menu —
  // NEVER from the client body. Drives the welcome/IG discount amount and the
  // delivery/service fees below (see order-pricing.ts). Stays null only if the
  // menu fetch fails (rare cache outage), in which case discounts are skipped
  // entirely and fees fall back to the legacy client-price path.
  let priceMaps: AuthoritativePriceMaps | null = null;
  try {
    const menu = await getMenu();
    priceMaps = buildAuthoritativePriceMaps(menu);
    const variationSoldOut = new Map<string, { name: string; soldOut: boolean }>();
    const modifierSoldOut = new Map<string, { name: string; soldOut: boolean }>();
    for (const items of menu.itemsBySlug.values()) {
      for (const item of items) {
        for (const v of item.variations) {
          variationSoldOut.set(v.id, {
            name: `${item.name}${v.name ? ` (${v.name})` : ""}`,
            soldOut: v.soldOut,
          });
        }
      }
    }
    for (const item of menu.uncategorizedItems) {
      for (const v of item.variations) {
        variationSoldOut.set(v.id, {
          name: `${item.name}${v.name ? ` (${v.name})` : ""}`,
          soldOut: v.soldOut,
        });
      }
    }
    for (const ml of menu.modifierLists.values()) {
      for (const mod of ml.modifiers) {
        modifierSoldOut.set(mod.id, { name: mod.name, soldOut: mod.soldOut });
      }
    }
    const soldOutNames: string[] = [];
    for (const line of body.lines) {
      const v = variationSoldOut.get(line.variationId);
      if (v?.soldOut) soldOutNames.push(v.name);
      for (const m of line.modifiers) {
        const mod = modifierSoldOut.get(m.id);
        if (mod?.soldOut) soldOutNames.push(mod.name);
      }
    }
    if (soldOutNames.length > 0) {
      const unique = Array.from(new Set(soldOutNames));
      return NextResponse.json(
        {
          ok: false,
          error: `Sold out: ${unique.join(", ")}. Please refresh the menu.`,
          soldOut: unique,
        },
        { status: 409 },
      );
    }
    // A line the catalog has never heard of is NOT sold out — it has no entry
    // at all, so the loop above waves it through and Square rejects the create
    // with its own wording. Reject it here instead, in the same shape the quote
    // uses (#84), so the customer is told what to do rather than shown a
    // payment failure. Reachable without forgery: an item deleted and re-added
    // in Square gets a new id, and the old one sits in a persisted cart.
    const unknown = unknownVariationIds(body.lines, priceMaps);
    if (unknown.length > 0) {
      reportDegraded("orders.create-stale-cart", { unknown });
      return NextResponse.json(
        {
          ok: false,
          error: STALE_CART_MESSAGE,
          unknownVariationIds: unknown,
        },
        { status: 409 },
      );
    }
  } catch {
    // If the menu fetch fails we don't block the order — Square will
    // still catch missing catalog ids. The sold-out gate is defense in
    // depth, not the authoritative source.
  }

  const customerId = user.profile.square_customer_id;
  const recipientPhone = user.profile.phone_e164;

  const lineItems = body.lines.map((line) => ({
    quantity: String(line.quantity),
    catalogObjectId: line.variationId,
    modifiers: dedupeLineModifiers(line.modifiers),
  }));

  // Needed before the pricing call so an under-minimum delivery order is
  // rejected without paying for the promo/tier lookups.
  const drinksSubtotalCents = drinksSubtotalFor(body.lines, priceMaps);

  const isDelivery = body.fulfillmentType === "DELIVERY";
  const deliveryFullAddress =
    isDelivery && body.delivery
      ? body.delivery.unit
        ? `${body.delivery.unit}, ${body.delivery.address}`
        : body.delivery.address
      : null;

  // Boss-controlled delivery kill-switch (Admin → app_settings.delivery_enabled).
  // Server-authoritative so it gates web AND the App (shared route), regardless
  // of a stale client UI still showing the delivery option. Runs before the
  // per-field prerequisites so a delivery order can never reach Square while the
  // shop has delivery switched off. Fires for any delivery order, even one with
  // missing details.
  if (isDelivery && !(await isDeliveryEnabled())) {
    return NextResponse.json(
      {
        ok: false,
        error: "Delivery is currently unavailable. Please choose Pickup.",
        deliveryDisabled: true,
      },
      { status: 409 },
    );
  }

  // Delivery prerequisites — eligibility, hours, radius. These run regardless
  // of free-redeem because they're not surcharges, they're "is this even a
  // valid order" gates. A loyalty reward doesn't waive the radius/hours rules.
  if (isDelivery && body.delivery) {
    if (!isDeliveryEligible(drinksSubtotalCents)) {
      return NextResponse.json(
        { ok: false, error: "Below minimum order for delivery" },
        { status: 400 },
      );
    }
    if (!isDeliveryHoursOpen()) {
      return NextResponse.json(
        { ok: false, error: "Outside delivery hours" },
        { status: 400 },
      );
    }
    if (!isDeliverablePostcode(body.delivery.postcode)) {
      return NextResponse.json(
        { ok: false, error: "Postcode not in delivery zone" },
        { status: 400 },
      );
    }
  } else if (isDelivery && !body.delivery) {
    return NextResponse.json(
      { ok: false, error: "Delivery details missing" },
      { status: 400 },
    );
  }

  // Pickup ASAP — pickupAt is required by Square even for ASAP orders,
  // so we use "now" as a reasonable approximation.
  const pickupAt = new Date().toISOString();

  // Daily online order number (OL800, OL801, …) shown to the customer
  // on the confirmation page AND written to Square's ticketName so
  // staff see the same number on the POS / Dashboard / kitchen printer.
  let pickupNumber: string;
  try {
    pickupNumber = await nextOnlineOrderNumber();
    // Delivery orders get a DE-prefixed number (DE800 vs the OL800 pickup
    // series) so staff distinguish them at a glance in Square Register —
    // more robust than an emoji, which Register hardware can garble. Same
    // atomic counter, just a relabelled prefix.
    if (isDelivery) pickupNumber = pickupNumber.replace(/^OL/, "DE");
  } catch {
    return NextResponse.json(
      { ok: false, error: "Failed to generate order number" },
      { status: 500 },
    );
  }

  try {
    // Every discount and every service charge for this cart, decided once in
    // the shared pricing module. `POST /api/orders/quote` calls the same
    // function with the same body, which is what makes the checkout summary
    // the customer reads match what this create call is about to charge.
    const pricing = await computeOrderPricing({
      lines: body.lines,
      applyWelcomeDiscount: body.applyWelcomeDiscount,
      applyIgFollowDiscount: body.applyIgFollowDiscount,
      applyLoyaltyReward: body.applyLoyaltyReward,
      loyaltyRewardCount: body.loyaltyRewardCount,
      isDelivery,
      delivery: body.delivery ?? null,
      customerId,
      recipientPhone,
      priceMaps,
    });
    const allDiscounts = pricing.discounts;
    const orderServiceCharges = pricing.serviceCharges;
    const { welcomeDrinksCovered, igFollowDrinksCovered, tierToppingsCovered } =
      pricing;

    // Dedupe order creation so a retry of the same checkout attempt reuses the
    // original order instead of making a duplicate + second charge.
    const orderIdempotencyKey = deriveOrderIdempotencyKey(
      customerId,
      body.idempotencyKey,
    );

    // Server-side backstop for duplicate orders: the client nonce can't dedupe a
    // re-submit from a different device/browser (different client key). Stamp a
    // cart fingerprint on every order and, before creating a new one, reuse a
    // recent identical order from the same customer if one exists.
    const cartFingerprint = cartHash(body.lines);
    const DEDUP_WINDOW_MS = 5 * 60 * 1000;
    if (customerId) {
      try {
        const recent = await squareClient.orders.search({
          locationIds: [SQUARE_LOCATION_ID],
          limit: 20,
          query: {
            filter: {
              customerFilter: { customerIds: [customerId] },
              stateFilter: { states: ["OPEN", "COMPLETED"] },
              dateTimeFilter: {
                createdAt: {
                  startAt: new Date(Date.now() - DEDUP_WINDOW_MS).toISOString(),
                },
              },
            },
            sort: { sortField: "CREATED_AT", sortOrder: "DESC" },
          },
        });
        const dup = pickDuplicateOrder(
          recent.orders ?? [],
          cartFingerprint,
          DEDUP_WINDOW_MS,
          Date.now(),
        );
        if (dup?.id) {
          return NextResponse.json({
            ok: true,
            orderId: dup.id,
            amountCents: dup.totalMoney?.amount?.toString() ?? "0",
            order: serializeSquareResponse(dup),
            deduped: true,
          });
        }
      } catch {
        // A search failure must never block a real order — fall through and
        // create normally (the client nonce + Square key still protect retries).
      }
    }

    const response = await squareClient.orders.create({
      idempotencyKey: orderIdempotencyKey,
      order: {
        locationId: SQUARE_LOCATION_ID,
        customerId,
        referenceId: pickupNumber,
        ticketName: pickupNumber,
        lineItems,
        discounts: allDiscounts.length > 0 ? allDiscounts : undefined,
        // Passes Square card-processing fees (and PH surcharge) through to the
        // customer. SUBTOTAL_PHASE computes them on the POST-discount amount —
        // a welcome discount DOES shrink them (measured 2026-07-28; the comment
        // that used to sit here claimed the opposite and the old client-side
        // summary mirror believed it). taxable:false → menu items are already
        // GST-inclusive; these are pass-through fees listed separately.
        serviceCharges: orderServiceCharges.length > 0 ? orderServiceCharges : undefined,
        // Self-delivery orders are created as PICKUP fulfillments — Square hides
        // DELIVERY-type orders from the seller POS without a partnership. The
        // 🚚 delivery address + phone are stamped into the note (the field
        // Square Register displays) so staff see where to drive it.
        fulfillments: [
          {
            type: "PICKUP" as const,
            state: "PROPOSED" as const,
            pickupDetails: {
              scheduleType: "ASAP" as const,
              pickupAt,
              recipient: {
                customerId,
                displayName: pickupNumber,
                phoneNumber: recipientPhone,
              },
              note:
                isDelivery && body.delivery && deliveryFullAddress
                  ? deliveryFulfillmentNote({
                      address: deliveryFullAddress,
                      phone: recipientPhone,
                      driverNote: body.delivery.driverNote,
                      orderNote: body.note,
                    })
                  : [pickupNumber, body.note].filter(Boolean).join(" — "),
            },
          },
        ],
        // Square caps metadata at ~10 entries — the worst case here is
        // exactly 10 (see order-metadata.test.ts, which pins the budget).
        metadata: buildOrderMetadata({
          clientPlatform,
          appVersion,
          appPlatform,
          cartFingerprint,
          site: BUSINESS.domain,
          welcomeDrinksCovered,
          igFollowDrinksCovered,
          tierToppingsCovered,
          delivery:
            isDelivery && body.delivery && deliveryFullAddress
              ? {
                  address: deliveryFullAddress,
                  lat: body.delivery.lat,
                  lng: body.delivery.lng,
                }
              : null,
        }),
      },
    });

    const orderId = response.order?.id;
    if (!orderId) {
      return NextResponse.json(
        { ok: false, error: "Square did not return an order id" },
        { status: 502 },
      );
    }

    const amountCents = response.order?.totalMoney?.amount?.toString() ?? "0";

    return NextResponse.json({
      ok: true,
      orderId,
      amountCents,
      order: serializeSquareResponse(response.order),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
