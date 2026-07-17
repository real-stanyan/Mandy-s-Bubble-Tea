import { NextResponse } from "next/server";
import { deriveOrderIdempotencyKey } from "@/lib/order-idempotency";
import { cartHash, pickDuplicateOrder } from "@/lib/order-dedup";
import type { Currency, OrderServiceCharge } from "square";
import { squareClient, SQUARE_LOCATION_ID } from "@/lib/square";
import { BUSINESS, CARD_SURCHARGE, DELIVERY_FEE_NAME, PH_SURCHARGE, PLATFORM_FEE, SERVICE_FEE } from "@/lib/constants";
import { getActivePublicHoliday } from "@/lib/holiday";
import { getEffectiveOrderingStatus, isDeliveryEnabled } from "@/lib/store-status-server";
import { serializeSquareResponse } from "@/lib/utils";
import { clientPlatformFrom } from "@/lib/client-platform";
import {
  buildOrderMetadata,
  sanitizeAppPlatform,
  sanitizeAppVersion,
} from "@/lib/order-metadata";
import { nextOnlineOrderNumber, getWelcomeDiscountStatus } from "@/lib/supabase";
import { getIgFollowDiscountStatus } from "@/lib/ig-follow-discount";
import { getFlashPromoStatus } from "@/lib/flash-promo";
import { pickPromoCups } from "@/lib/promo-cup-pick";
import { getAuthedUser } from "@/lib/auth";
import { getMenu } from "@/lib/catalog";
import {
  authoritativeSubtotalCents,
  authoritativeUnitPrice,
  authoritativeUnitPrices,
  buildAuthoritativePriceMaps,
  type AuthoritativePriceMaps,
} from "@/lib/order-pricing";
import { findLoyaltyAccountByPhone } from "@/lib/loyalty";
import {
  brisbaneMonthKey,
  tierFor,
  TIER_DISCOUNT_PERCENT,
} from "@/lib/membership-tier";
import {
  collectPaidToppingUnits,
  coverFreeToppings,
  type CupRecord,
} from "@/lib/tier-toppings";
import { getToppingAllowanceStatus } from "@/lib/tier-toppings-store";
import { dedupeLineModifiers } from "@/lib/order-modifiers";
import {
  deliveryFeeCents,
  freeDeliverySubtotalCents,
  isDeliveryEligible,
  paidDrinksSubtotalCents,
  serviceFeeCents,
} from "@/lib/delivery-fee";
import { isDeliveryHoursOpen } from "@/lib/delivery-hours";
import { distanceKm, STORE_COORDS } from "@/lib/places";
import { isDeliverablePostcode } from "@/lib/delivery-zone";
import { deliveryFulfillmentNote } from "@/lib/delivery-ticket";

// Tier perks are optional — never let a slow loyalty API stall order creation.
const TIER_LOOKUP_TIMEOUT_MS = 3000;

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
};

function isValidBody(body: unknown): body is CreateOrderBody {
  if (!body || typeof body !== "object") return false;
  const b = body as Partial<CreateOrderBody>;
  if (b.idempotencyKey !== undefined && typeof b.idempotencyKey !== "string") {
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

  // Server-authoritative drinks subtotal (cents) from the Square catalog menu.
  // This gates delivery eligibility + free-delivery thresholds, so it must NOT
  // trust client prices (a forged price could fake the free-delivery subtotal).
  // Fallback to the legacy client-price computation ONLY if the menu fetch
  // failed above (priceMaps null) so a cache outage doesn't block all delivery.
  const drinksSubtotalCents: bigint = priceMaps
    ? authoritativeSubtotalCents(body.lines, priceMaps)
    : body.lines.reduce((sum, line) => {
        const modSum = line.modifiers.reduce(
          (s, m) => s + BigInt(Math.max(0, Math.floor(m.priceCents))),
          0n,
        );
        const unit =
          BigInt(Math.max(0, Math.floor(line.variationPriceCents))) + modSum;
        return sum + unit * BigInt(Math.max(1, line.quantity));
      }, 0n);

  // Estimated money covered by loyalty-reward cups: the cheapest N unit
  // prices, mirroring pickPromoCups and the tier-discount math. Square only
  // attaches the reward discount AFTER order creation (CreateLoyaltyReward),
  // so this estimate is how the delivery-fee math can see it at create time.
  // Falls back to client prices only when the menu cache is down, same as
  // drinksSubtotalCents above.
  const loyaltyRewardCount = Math.max(
    0,
    Math.floor(body.loyaltyRewardCount ?? 0),
  );
  const unitPricesAsc: bigint[] = (priceMaps
    ? authoritativeUnitPrices(body.lines, priceMaps)
    : body.lines.flatMap((line) => {
        const modSum = line.modifiers.reduce(
          (s, m) => s + BigInt(Math.max(0, Math.floor(m.priceCents))),
          0n,
        );
        const unit =
          BigInt(Math.max(0, Math.floor(line.variationPriceCents))) + modSum;
        return Array.from(
          { length: Math.max(1, Math.floor(line.quantity)) },
          () => unit,
        );
      })
  ).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const rewardCupsSumCents = unitPricesAsc
    .slice(0, Math.min(loyaltyRewardCount, unitPricesAsc.length))
    .reduce((s, p) => s + p, 0n);

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
    // Server-verify welcome and IG-follow discounts before attaching them.
    // Client is NOT trusted — a request with applyWelcomeDiscount or
    // applyIgFollowDiscount: true but no unused row in Supabase is silently
    // treated as "no discount".
    // Compute the discount amounts server-side from AUTHORITATIVE catalog
    // prices (priceMaps, built from getMenu above) — never from the client
    // body. A forged variationPriceCents/priceCents cannot inflate the
    // FIXED_AMOUNT discount (which would zero out the whole cart). See
    // order-pricing.ts. If the menu fetch failed, priceMaps is null and the
    // discount is skipped entirely rather than trusting client prices.
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

      // Welcome (new-customer) discount is pickup-only — never applied to, or
      // consumed by, delivery orders. Server-authoritative gate.
      const welcomeK =
        !isDelivery &&
        welcomeStatus.available &&
        welcomeStatus.drinksRemaining > 0
          ? welcomeStatus.drinksRemaining
          : 0;
      const igK =
        igStatus.available && igStatus.drinksRemaining > 0
          ? igStatus.drinksRemaining
          : 0;

      // priceMaps is required to size the discount: the FIXED_AMOUNT is real
      // money, so a forged client price must never reach the discount math.
      // If the menu fetch failed (priceMaps null) we skip the discount this
      // order rather than fall back to client prices (fail safe for merchant).
      if ((welcomeK > 0 || igK > 0) && priceMaps) {
        const unitPrices = authoritativeUnitPrices(body.lines, priceMaps);

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

    // ---- Membership tier perks (server-authoritative; client never sends tier).
    // Derived live from Square loyalty lifetimePoints. Any failure here must
    // never block the order — fail-safe to "no tier perks".
    let tierDiscounts:
      | Array<{
          uid: string;
          name: string;
          type: "FIXED_AMOUNT";
          amountMoney: { amount: bigint; currency: Currency };
          scope: "ORDER";
        }>
      | undefined;
    let tierToppingsCovered = 0;

    if (priceMaps) {
      try {
        const loyaltyAccount = await Promise.race([
          findLoyaltyAccountByPhone(recipientPhone),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("tier loyalty lookup timed out")),
              TIER_LOOKUP_TIMEOUT_MS,
            ),
          ),
        ]);
        const tier = tierFor(loyaltyAccount?.lifetimePoints ?? 0);

        if (tier === "gold" || tier === "diamond") {
          const welcomeAmount = welcomeDiscounts?.[0]?.amountMoney.amount ?? 0n;
          const igAmount = igFollowDiscounts?.[0]?.amountMoney.amount ?? 0n;

          // Reward cups = cheapest N unit prices — hoisted above (shared with
          // the delivery-fee math), mirrors pickPromoCups.
          const rewardCount = loyaltyRewardCount;
          const rewardCupsSum = rewardCupsSumCents;

          // Diamond: monthly free toppings (paid toppings only, most expensive
          // first, reward cups excluded — their toppings are already free).
          let toppingAmount = 0n;
          if (tier === "diamond") {
            const cups: CupRecord[] = [];
            for (const line of body.lines) {
              const unitPrice = authoritativeUnitPrice(line, priceMaps);
              const toppingPrices = line.modifiers.map(
                (m) => priceMaps.modifierPriceById.get(m.id) ?? 0n,
              );
              const qty = Math.max(1, Math.floor(line.quantity));
              for (let i = 0; i < qty; i++) cups.push({ unitPrice, toppingPrices });
            }
            const pool = collectPaidToppingUnits(cups, rewardCount);
            if (pool.length > 0) {
              const status = await getToppingAllowanceStatus(
                customerId,
                brisbaneMonthKey(),
              );
              const cover = coverFreeToppings(pool, status.remaining);
              if (cover.amount > 0n) {
                toppingAmount = cover.amount;
                tierToppingsCovered = cover.coveredCount;
              }
            }
          }

          // 5% on what the customer actually pays for drinks — never the same
          // dollar twice (welcome/IG/reward/free-topping money excluded).
          let base =
            drinksSubtotalCents -
            welcomeAmount -
            igAmount -
            rewardCupsSum -
            toppingAmount;
          if (base < 0n) base = 0n;
          const tierAmount = (base * BigInt(TIER_DISCOUNT_PERCENT)) / 100n;

          const built: NonNullable<typeof tierDiscounts> = [];
          if (toppingAmount > 0n) {
            built.push({
              uid: "tier-topping-allowance",
              name: `Diamond Free Toppings (${tierToppingsCovered})`,
              type: "FIXED_AMOUNT",
              amountMoney: { amount: toppingAmount, currency: BUSINESS.currency as Currency },
              scope: "ORDER",
            });
          }
          if (tierAmount > 0n) {
            built.push({
              uid: "tier-discount",
              name: tier === "diamond" ? "Diamond Member 5% Off" : "Gold Member 5% Off",
              type: "FIXED_AMOUNT",
              amountMoney: { amount: tierAmount, currency: BUSINESS.currency as Currency },
              scope: "ORDER",
            });
          }
          if (built.length > 0) tierDiscounts = built;
        }
      } catch (tierError) {
        console.error(
          "[orders] tier perks skipped:",
          tierError instanceof Error ? tierError.message : tierError,
        );
        // Keep metadata consistent with the (now dropped) discounts: if the
        // topping count was already set before the failure, reset it.
        tierDiscounts = undefined;
        tierToppingsCovered = 0;
      }
    }

    // ---- Flash promo (store-wide, one Brisbane day, one order per customer).
    // Server-authoritative: verified against Supabase (promo active today AND
    // no redemption row for this customer). EXCLUSIVE, not stackable: the
    // order gets either the flash discount or the welcome/IG/tier bundle,
    // whichever is worth more — flash never suppresses a better deal for a
    // new customer, and auto tier 5% never locks a member out of the promo.
    // Loyalty-reward cups are not a discount (earned stars); they just come
    // off the flash base so a free cup is never also 20%-off.
    // The promo key rides inside the uid ("flash-promo:<key>") because the
    // Square metadata budget is already at its 10-entry worst case; the
    // burn path parses it back out (see consume-order-discounts.ts).
    let flashDiscounts:
      | Array<{
          uid: string;
          name: string;
          type: "FIXED_AMOUNT";
          amountMoney: { amount: bigint; currency: Currency };
          scope: "ORDER";
        }>
      | undefined;

    // Auto-applied (the client flag is NOT required): shipped app binaries
    // predate this promo and can't send applyFlashPromo, but their charge is
    // server-computed from the order total, so attaching the discount here
    // still reaches them — the wallet sheet just shows the pre-discount
    // amount and Square captures less.
    if (priceMaps) {
      try {
        const flash = await getFlashPromoStatus(customerId);
        if (flash.available && flash.key) {
          const otherDiscountsCents = [
            ...(welcomeDiscounts ?? []),
            ...(igFollowDiscounts ?? []),
            ...(tierDiscounts ?? []),
          ].reduce((s, d) => s + d.amountMoney.amount, 0n);
          let base = drinksSubtotalCents - rewardCupsSumCents;
          if (base < 0n) base = 0n;
          const amount = (base * BigInt(flash.percentage)) / 100n;
          if (amount > 0n && amount > otherDiscountsCents) {
            flashDiscounts = [
              {
                uid: `flash-promo:${flash.key}`,
                name: `Flash Sale ${flash.percentage}% Off`,
                type: "FIXED_AMOUNT",
                amountMoney: { amount, currency: BUSINESS.currency as Currency },
                scope: "ORDER",
              },
            ];
            // Exclusive: flash replaces the whole promo bundle. Zero the
            // covered counts too so the order metadata never claims a
            // discount that isn't attached (the burn paths gate on the
            // discount uid, but the metadata must not lie).
            welcomeDiscounts = undefined;
            igFollowDiscounts = undefined;
            tierDiscounts = undefined;
            welcomeDrinksCovered = 0;
            igFollowDrinksCovered = 0;
            tierToppingsCovered = 0;
          }
        }
      } catch (flashError) {
        console.error(
          "[orders] flash promo skipped:",
          flashError instanceof Error ? flashError.message : flashError,
        );
      }
    }

    const allDiscounts = [
      ...(welcomeDiscounts ?? []),
      ...(igFollowDiscounts ?? []),
      ...(tierDiscounts ?? []),
      ...(flashDiscounts ?? []),
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

    const orderServiceCharges: OrderServiceCharge[] = [];

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

    // Delivery + service fees on every DELIVERY order — including star-redeem
    // orders (2026-07-10: a free drink still pays for its own delivery, so
    // these two are NOT under skipSurcharges). Both are computed on the
    // POST-discount paid drinks amount: attached discounts (welcome/IG/tier/
    // toppings) plus the estimated loyalty-reward cups all come off before
    // the free-delivery threshold and the 5% service fee are sized.
    const attachedDiscountsCents = allDiscounts.reduce(
      (s, d) => s + d.amountMoney.amount,
      0n,
    );
    const paidDrinksCents = paidDrinksSubtotalCents(
      drinksSubtotalCents,
      attachedDiscountsCents + rewardCupsSumCents,
    );
    if (isDelivery && body.delivery) {
      const distKm = distanceKm(STORE_COORDS, {
        lat: body.delivery.lat,
        lng: body.delivery.lng,
      });
      // Free-delivery threshold is judged on the surcharge-inclusive paid
      // subtotal (paid drinks + 5% service + platform/card/PH when they apply),
      // not bare paid drinks. Redeem orders skip platform/card/PH, so only the
      // service fee folds in for them. Distance band / service fee are unchanged.
      const fee = deliveryFeeCents(
        freeDeliverySubtotalCents(paidDrinksCents, {
          orderSurcharges: !skipSurcharges,
          publicHoliday: !!activePH,
        }),
        distKm,
      );
      if (fee > 0n) {
        orderServiceCharges.push({
          uid: "delivery-fee",
          name: DELIVERY_FEE_NAME,
          amountMoney: { amount: fee, currency: BUSINESS.currency as Currency },
          calculationPhase: "SUBTOTAL_PHASE",
          taxable: false,
        });
      }
      const svc = serviceFeeCents(paidDrinksCents);
      if (svc > 0n) {
        orderServiceCharges.push({
          uid: "service-fee",
          name: `${SERVICE_FEE.name} (${SERVICE_FEE.percentage}%)`,
          amountMoney: { amount: svc, currency: BUSINESS.currency as Currency },
          calculationPhase: "SUBTOTAL_PHASE",
          taxable: false,
        });
      }
    }

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
        // Passes Square card-processing fees (and PH surcharge) through
        // to the customer. SUBTOTAL_PHASE → computed on the pre-discount
        // subtotal so surcharges don't shrink when a welcome discount is
        // applied. taxable:false → menu items are already GST-inclusive;
        // these are pass-through fees listed separately.
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
