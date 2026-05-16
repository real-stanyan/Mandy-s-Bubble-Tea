import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import type { Currency } from "square";
import { squareClient, SQUARE_LOCATION_ID } from "@/lib/square";
import { BUSINESS, CARD_SURCHARGE, PH_SURCHARGE, PLATFORM_FEE } from "@/lib/constants";
import { getActivePublicHoliday } from "@/lib/holiday";
import { getEffectiveOrderingStatus } from "@/lib/store-status";
import { serializeSquareResponse } from "@/lib/utils";
import { nextOnlineOrderNumber, getWelcomeDiscountStatus } from "@/lib/supabase";
import { getIgFollowDiscountStatus } from "@/lib/ig-follow-discount";
import { pickPromoCups } from "@/lib/promo-cup-pick";
import { getAuthedUser } from "@/lib/auth";
import { getMenu } from "@/lib/catalog";
import { dedupeLineModifiers } from "@/lib/order-modifiers";

// Creates a Square order from the client cart. Identity is derived
// entirely from the Supabase session — the client does NOT send a
// customerId or phone. Prices are trusted to Square via
// catalogObjectId references so Square recomputes pricing against the
// current catalog. This also means tax/loyalty rules configured in the
// Square Dashboard apply automatically.

type ClientLineModifier = {
  id: string;
  name?: string;
  /** Modifier upcharge in cents. 0 for included/free modifiers. */
  priceCents: number;
};

type ClientLine = {
  itemName: string;
  variationId: string;
  variationName?: string;
  /** Variation base price in cents (excluding modifiers). */
  variationPriceCents: number;
  modifiers: ClientLineModifier[];
  quantity: number;
};

type CreateOrderBody = {
  lines: ClientLine[];
  note?: string;
  applyWelcomeDiscount?: boolean;
  applyIgFollowDiscount?: boolean;
  /** Client signals a loyalty reward will fully cover the order. When
   *  true we skip the card surcharge because no card is charged
   *  (payment amount is $0 after reward redemption). Trusted the same
   *  way applyWelcomeDiscount is — abuse risk is ~1.9% per order, same
   *  order of magnitude as welcome-discount gaming. */
  applyLoyaltyReward?: boolean;
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
};

function isValidBody(body: unknown): body is CreateOrderBody {
  if (!body || typeof body !== "object") return false;
  const b = body as Partial<CreateOrderBody>;
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
  });
}

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

  if (!isValidBody(body)) {
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
  try {
    const menu = await getMenu();
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

  // Pickup ASAP — pickupAt is required by Square even for ASAP orders,
  // so we use "now" as a reasonable approximation.
  const pickupAt = new Date().toISOString();

  // Daily online order number (OL800, OL801, …) shown to the customer
  // on the confirmation page AND written to Square's ticketName so
  // staff see the same number on the POS / Dashboard / kitchen printer.
  let pickupNumber: string;
  try {
    pickupNumber = await nextOnlineOrderNumber();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Failed to generate order number" },
      { status: 500 },
    );
  }

  try {
    // Server-verify welcome and IG-follow discounts before attaching them.
    // Client is NOT trusted — a request with applyWelcomeDiscount or
    // applyIgFollowDiscount: true but no unused row in Supabase is silently
    // treated as "no discount".
    // Compute the discount amounts server-side from client-sent unit prices.
    // The client has authoritative prices (they came from our catalog API
    // at add-to-cart time); a malicious client can only shift *which*
    // drinks are chosen as cheapest, and since the rates are bounded
    // percentages, the merchant's downside is bounded. If we later harden
    // this we'll call `squareClient.orders.calculate()` first to get
    // Square's authoritative line totals, but for now trust-client is fine.
    let welcomeDiscounts:
      | Array<{
          uid: string;
          name: string;
          type: "FIXED_AMOUNT";
          amountMoney: { amount: bigint; currency: Currency };
          scope: "ORDER";
        }>
      | undefined;
    let igFollowDiscounts:
      | Array<{
          uid: string;
          name: string;
          type: "FIXED_AMOUNT";
          amountMoney: { amount: bigint; currency: Currency };
          scope: "ORDER";
        }>
      | undefined;
    let welcomeDrinksCovered = 0;
    let igFollowDrinksCovered = 0;

    if (body.applyWelcomeDiscount || body.applyIgFollowDiscount) {
      const [welcomeStatus, igStatus] = await Promise.all([
        body.applyWelcomeDiscount
          ? getWelcomeDiscountStatus(customerId)
          : Promise.resolve({ available: false, percentage: 0, drinksRemaining: 0 }),
        body.applyIgFollowDiscount
          ? getIgFollowDiscountStatus(customerId)
          : Promise.resolve({
              available: false,
              percentage: 0,
              drinksRemaining: 0,
              claimedAt: null,
              redeemedAt: null,
            }),
      ]);

      const welcomeK =
        welcomeStatus.available && welcomeStatus.drinksRemaining > 0
          ? welcomeStatus.drinksRemaining
          : 0;
      const igK =
        igStatus.available && igStatus.drinksRemaining > 0
          ? igStatus.drinksRemaining
          : 0;

      if (welcomeK > 0 || igK > 0) {
        const unitPrices: bigint[] = [];
        for (const line of body.lines) {
          const modSum = line.modifiers.reduce(
            (s, m) => s + BigInt(Math.max(0, Math.floor(m.priceCents))),
            0n,
          );
          const unit =
            BigInt(Math.max(0, Math.floor(line.variationPriceCents))) + modSum;
          for (let i = 0; i < line.quantity; i++) unitPrices.push(unit);
        }

        const { welcomeCups, igFollowCups } = pickPromoCups({
          unitPrices,
          welcomeK,
          igFollowK: igK,
          loyaltyRewardCount: body.loyaltyRewardCount ?? 0,
        });

        if (welcomeCups.length > 0) {
          const coveredSum = welcomeCups.reduce((s, p) => s + p, 0n);
          const amount =
            (coveredSum * BigInt(welcomeStatus.percentage || 30)) / 100n;
          if (amount > 0n) {
            welcomeDiscounts = [
              {
                uid: "welcome-discount",
                name:
                  welcomeCups.length === 1
                    ? `Welcome ${welcomeStatus.percentage || 30}% Off (1 drink)`
                    : `Welcome ${welcomeStatus.percentage || 30}% Off (${welcomeCups.length} drinks)`,
                type: "FIXED_AMOUNT",
                amountMoney: { amount, currency: BUSINESS.currency as Currency },
                scope: "ORDER",
              },
            ];
            welcomeDrinksCovered = welcomeCups.length;
          }
        }

        if (igFollowCups.length > 0) {
          const coveredSum = igFollowCups.reduce((s, p) => s + p, 0n);
          const amount =
            (coveredSum * BigInt(igStatus.percentage || 10)) / 100n;
          if (amount > 0n) {
            igFollowDiscounts = [
              {
                uid: "ig-follow-discount",
                name:
                  igFollowCups.length === 1
                    ? `IG Follow ${igStatus.percentage || 10}% Off (1 drink)`
                    : `IG Follow ${igStatus.percentage || 10}% Off (${igFollowCups.length} drinks)`,
                type: "FIXED_AMOUNT",
                amountMoney: { amount, currency: BUSINESS.currency as Currency },
                scope: "ORDER",
              },
            ];
            igFollowDrinksCovered = igFollowCups.length;
          }
        }
      }
    }

    const allDiscounts = [
      ...(welcomeDiscounts ?? []),
      ...(igFollowDiscounts ?? []),
    ];

    // Note: loyalty rewards are NOT attached here. Square's order
    // create request has no loyaltyRewards field — the discount is
    // applied by calling CreateLoyaltyReward with this orderId
    // AFTER the order exists. The checkout flow does that step
    // right after this route returns.

    // Public-holiday surcharge is detected server-side (never trust client).
    // Ordered BEFORE card-surcharge so receipts list PH first.
    // Card surcharge is skipped when a loyalty reward fully covers the order
    // (no card charged → nothing to pass through). The PH surcharge follows
    // the same rule: a fully-redeemed free drink skips both.
    const activePH = getActivePublicHoliday(new Date());
    const skipSurcharges =
      (body.loyaltyRewardCount ?? 0) > 0 ||
      body.applyLoyaltyReward === true;

    const orderServiceCharges: Array<{
      uid: string;
      name: string;
      percentage: string;
      calculationPhase: "SUBTOTAL_PHASE";
      taxable: boolean;
    }> = [];

    if (!skipSurcharges && activePH) {
      console.log(`[orders] PH surcharge attached: ${activePH.name}`);
      orderServiceCharges.push({
        uid: "public-holiday-surcharge",
        name: `${PH_SURCHARGE.name} (${activePH.name})`,
        percentage: PH_SURCHARGE.percentage,
        calculationPhase: "SUBTOTAL_PHASE",
        taxable: false,
      });
    }

    if (!skipSurcharges) {
      orderServiceCharges.push({
        uid: "platform-fee",
        name: PLATFORM_FEE.name,
        percentage: PLATFORM_FEE.percentage,
        calculationPhase: "SUBTOTAL_PHASE",
        taxable: false,
      });

      orderServiceCharges.push({
        uid: "card-surcharge",
        name: CARD_SURCHARGE.name,
        percentage: CARD_SURCHARGE.percentage,
        calculationPhase: "SUBTOTAL_PHASE",
        taxable: false,
      });
    }

    const response = await squareClient.orders.create({
      idempotencyKey: randomUUID(),
      order: {
        locationId: SQUARE_LOCATION_ID,
        customerId,
        referenceId: pickupNumber,
        ticketName: pickupNumber,
        lineItems,
        discounts: allDiscounts.length > 0 ? allDiscounts : undefined,
        // Passes Square card-processing fees (and PH surcharge) through
        // to the customer. SUBTOTAL_PHASE → computed on the pre-discount
        // subtotal so surcharges don't shrink when a welcome discount is
        // applied. taxable:false → menu items are already GST-inclusive;
        // these are pass-through fees listed separately.
        serviceCharges: orderServiceCharges.length > 0 ? orderServiceCharges : undefined,
        fulfillments: [
          {
            type: "PICKUP",
            state: "PROPOSED",
            pickupDetails: {
              scheduleType: "ASAP",
              pickupAt,
              recipient: {
                customerId,
                displayName: pickupNumber,
                phoneNumber: recipientPhone,
              },
              note: [pickupNumber, body.note].filter(Boolean).join(" — "),
            },
          },
        ],
        metadata: {
          source: "web",
          site: BUSINESS.domain,
          ...(welcomeDrinksCovered > 0
            ? { welcomeDiscountDrinksCovered: String(welcomeDrinksCovered) }
            : {}),
          ...(igFollowDrinksCovered > 0
            ? { igFollowDiscountDrinksCovered: String(igFollowDrinksCovered) }
            : {}),
        },
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
