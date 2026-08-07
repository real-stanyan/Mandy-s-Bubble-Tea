import type { Currency, OrderServiceCharge } from "square";
import {
  BUSINESS,
  CARD_SURCHARGE,
  DELIVERY_FEE_NAME,
  PH_SURCHARGE,
  PLATFORM_FEE,
  SERVICE_FEE,
} from "@/lib/constants";
import { getActivePublicHoliday } from "@/lib/holiday";
import { getWelcomeDiscountStatus } from "@/lib/supabase";
import { getIgFollowDiscountStatus } from "@/lib/ig-follow-discount";
import { getFlashPromoStatus, flashPromoUid } from "@/lib/flash-promo";
import { getAppDownloadDiscountStatus } from "@/lib/app-download-discount";
import {
  getActiveTastingPromo,
  tastingDiscountFor,
  tastingPromoUid,
} from "@/lib/tasting-promo";
import { pickPromoCups } from "@/lib/promo-cup-pick";
import {
  authoritativeCups,
  authoritativeSubtotalCents,
  authoritativeUnitPrice,
  authoritativeUnitPrices,
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
import { reportDegraded } from "@/lib/degraded";
import {
  deliveryFeeCents,
  freeDeliverySubtotalCents,
  paidDrinksSubtotalCents,
  serviceFeeCents,
} from "@/lib/delivery-fee";
import { distanceKm, STORE_COORDS } from "@/lib/places";

// THE pricing decision for an online order — every discount and every service
// charge, in one place, computed once from server-authoritative catalog money.
//
// It lives here and not in the orders route because two callers need the exact
// same answer: `POST /api/orders` (which hands it to Square) and
// `POST /api/orders/quote` (which shows it to the customer before they pay).
// Before this module the checkout pages re-derived it in TypeScript on the
// client — three copies of the same rules, drifting apart the moment one of
// them gained a promo the others didn't (that drift is web #73 / app#40; the
// history is in docs/adr/0003 and docs/adr/0005).
//
// Nothing here creates, mutates, or consumes anything: no order number is
// drawn, no grant is burned, no Square order is written. Calling it twice for
// the same cart is free and returns the same answer. That property is what
// makes it safe to run on every checkout render.

/** Discount shape Square's order API accepts, and the only one we build. */
export type OrderDiscount = {
  uid: string;
  name: string;
  type: "FIXED_AMOUNT";
  amountMoney: { amount: bigint; currency: Currency };
  scope: "ORDER";
};

/** Minimal cart line — structurally the client body's `lines[]` entry. */
export type QuoteLine = {
  variationId: string;
  variationPriceCents: number;
  modifiers: Array<{ id: string; priceCents: number }>;
  quantity: number;
};

export type OrderPricingInput = {
  lines: QuoteLine[];
  /** Client asks for the welcome discount; verified against Supabase here. */
  applyWelcomeDiscount?: boolean;
  /** Client asks for the IG-follow discount; verified against Supabase here. */
  applyIgFollowDiscount?: boolean;
  /** Legacy boolean from old app binaries — same meaning as a non-zero count. */
  applyLoyaltyReward?: boolean;
  loyaltyRewardCount?: number;
  isDelivery: boolean;
  delivery?: { lat: number; lng: number } | null;
  customerId: string;
  /** Signed-in customer's E.164 phone — the app-download grant is keyed by it. */
  recipientPhone: string;
  /** Authoritative catalog prices, or null when the menu fetch failed. */
  priceMaps: AuthoritativePriceMaps | null;
  /**
   * Which client is asking — the tasting promo is app-only, so this decides
   * whether it is even considered. Derived server-side from the request
   * headers (see client-platform.ts), never from the body. Omitted means
   * "web", which is the direction that under-promises.
   */
  clientPlatform?: "web" | "app";
  /** Injected so tests (and a quote) can pin the public-holiday check. */
  now?: Date;
};

export type OrderPricing = {
  /** Pre-discount drinks subtotal, from catalog money. */
  drinksSubtotalCents: bigint;
  /** Estimated money covered by loyalty-reward cups (cheapest N). */
  rewardCupsSumCents: bigint;
  discounts: OrderDiscount[];
  /**
   * Display-only annotations for a discount row, keyed by discount uid.
   *
   * Kept out of `discounts` on purpose: an OrderDiscount is the object we hand
   * to Square, and its `name` ends up on the customer's receipt. "3 left this
   * month" is true while they're choosing, and meaningless printed on a receipt
   * a week later — so it rides alongside, and only the quote surfaces it.
   */
  discountNotes: Record<string, string>;
  serviceCharges: OrderServiceCharge[];
  welcomeDrinksCovered: number;
  igFollowDrinksCovered: number;
  tierToppingsCovered: number;
  /** True when a loyalty reward covers the order, so no card is charged. */
  skipSurcharges: boolean;
};

// Tier perks are optional — never let a slow loyalty API stall order creation.
const TIER_LOOKUP_TIMEOUT_MS = 3000;

/** Cart money when the menu cache is down: client prices, floored at 0. */
function clientUnitPrice(line: QuoteLine): bigint {
  const modSum = line.modifiers.reduce(
    (s, m) => s + BigInt(Math.max(0, Math.floor(m.priceCents))),
    0n,
  );
  return BigInt(Math.max(0, Math.floor(line.variationPriceCents))) + modSum;
}

/**
 * Server-authoritative drinks subtotal (cents) from the Square catalog menu.
 * This gates delivery eligibility + free-delivery thresholds, so it must NOT
 * trust client prices (a forged price could fake the free-delivery subtotal).
 * Falls back to the legacy client-price computation ONLY when the menu fetch
 * failed (priceMaps null) so a cache outage doesn't block all delivery.
 *
 * Exported because the orders route needs it before pricing runs, to reject an
 * under-minimum delivery order without paying for the promo lookups.
 */
export function drinksSubtotalFor(
  lines: QuoteLine[],
  priceMaps: AuthoritativePriceMaps | null,
): bigint {
  return priceMaps
    ? authoritativeSubtotalCents(lines, priceMaps)
    : lines.reduce(
        (sum, line) =>
          sum + clientUnitPrice(line) * BigInt(Math.max(1, line.quantity)),
        0n,
      );
}

export async function computeOrderPricing(
  input: OrderPricingInput,
): Promise<OrderPricing> {
  const {
    lines,
    isDelivery,
    customerId,
    recipientPhone,
    priceMaps,
    now = new Date(),
  } = input;

  const drinksSubtotalCents = drinksSubtotalFor(lines, priceMaps);

  // Estimated money covered by loyalty-reward cups: the cheapest N unit
  // prices, mirroring pickPromoCups and the tier-discount math. Square only
  // attaches the reward discount AFTER order creation (CreateLoyaltyReward),
  // so this estimate is how the delivery-fee math can see it at create time.
  // Falls back to client prices only when the menu cache is down, same as
  // drinksSubtotalCents above.
  const loyaltyRewardCount = Math.max(
    0,
    Math.floor(input.loyaltyRewardCount ?? 0),
  );
  const unitPricesAsc: bigint[] = (
    priceMaps
      ? authoritativeUnitPrices(lines, priceMaps)
      : lines.flatMap((line) =>
          Array.from({ length: Math.max(1, Math.floor(line.quantity)) }, () =>
            clientUnitPrice(line),
          ),
        )
  ).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const rewardCupsSumCents = unitPricesAsc
    .slice(0, Math.min(loyaltyRewardCount, unitPricesAsc.length))
    .reduce((s, p) => s + p, 0n);

  // Server-verify welcome and IG-follow discounts before attaching them.
  // Client is NOT trusted — a request with applyWelcomeDiscount or
  // applyIgFollowDiscount: true but no unused row in Supabase is silently
  // treated as "no discount".
  // Compute the discount amounts server-side from AUTHORITATIVE catalog
  // prices (priceMaps) — never from the client body. A forged
  // variationPriceCents/priceCents cannot inflate the FIXED_AMOUNT discount
  // (which would zero out the whole cart). See order-pricing.ts. If the menu
  // fetch failed, priceMaps is null and the discount is skipped entirely
  // rather than trusting client prices.
  let welcomeDiscounts: OrderDiscount[] | undefined;
  let igFollowDiscounts: OrderDiscount[] | undefined;
  let welcomeDrinksCovered = 0;
  let igFollowDrinksCovered = 0;

  if (input.applyWelcomeDiscount || input.applyIgFollowDiscount) {
    const [welcomeStatus, igStatus] = await Promise.all([
      input.applyWelcomeDiscount
        ? getWelcomeDiscountStatus(customerId)
        : Promise.resolve({
            available: false,
            percentage: 0,
            drinksRemaining: 0,
          }),
      input.applyIgFollowDiscount
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
      !isDelivery && welcomeStatus.available && welcomeStatus.drinksRemaining > 0
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
      const unitPrices = authoritativeUnitPrices(lines, priceMaps);

      const { welcomeCups, igFollowCups } = pickPromoCups({
        unitPrices,
        welcomeK,
        igFollowK: igK,
        loyaltyRewardCount: input.loyaltyRewardCount ?? 0,
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
              amountMoney: {
                amount,
                currency: BUSINESS.currency as Currency,
              },
              scope: "ORDER",
            },
          ];
          welcomeDrinksCovered = welcomeCups.length;
        }
      }

      if (igFollowCups.length > 0) {
        const coveredSum = igFollowCups.reduce((s, p) => s + p, 0n);
        const amount = (coveredSum * BigInt(igStatus.percentage || 10)) / 100n;
        if (amount > 0n) {
          igFollowDiscounts = [
            {
              uid: "ig-follow-discount",
              name:
                igFollowCups.length === 1
                  ? `IG Follow ${igStatus.percentage || 10}% Off (1 drink)`
                  : `IG Follow ${igStatus.percentage || 10}% Off (${igFollowCups.length} drinks)`,
              type: "FIXED_AMOUNT",
              amountMoney: {
                amount,
                currency: BUSINESS.currency as Currency,
              },
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
  let tierDiscounts: OrderDiscount[] | undefined;
  let tierToppingsCovered = 0;
  // Allowance left AFTER this order, for the summary's "N left this month"
  // note. Deliberately post-order: pre-order is what the old client-side mirror
  // printed, and "×2 free … 5 left" reads as "5 left once I've paid" when it
  // actually meant 3. Null = no free-topping row on this order.
  let toppingsRemainingAfter: number | null = null;

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
          for (const line of lines) {
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
              toppingsRemainingAfter = Math.max(
                0,
                status.remaining - cover.coveredCount,
              );
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

        const built: OrderDiscount[] = [];
        if (toppingAmount > 0n) {
          built.push({
            uid: "tier-topping-allowance",
            name: `Diamond Free Toppings (${tierToppingsCovered})`,
            type: "FIXED_AMOUNT",
            amountMoney: {
              amount: toppingAmount,
              currency: BUSINESS.currency as Currency,
            },
            scope: "ORDER",
          });
        }
        if (tierAmount > 0n) {
          built.push({
            uid: "tier-discount",
            name:
              tier === "diamond"
                ? "Diamond Member 5% Off"
                : "Gold Member 5% Off",
            type: "FIXED_AMOUNT",
            amountMoney: {
              amount: tierAmount,
              currency: BUSINESS.currency as Currency,
            },
            scope: "ORDER",
          });
        }
        if (built.length > 0) tierDiscounts = built;
      }
    } catch (tierError) {
      // Fail-safe, and silent by design — but a Gold/Diamond member quietly
      // losing their 5% and their free toppings is a wrong price, not a
      // non-event. Same reporting rule as the quote route's fallbacks.
      reportDegraded("order-quote.tier-perks-skipped", { customerId }, tierError);
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
  // The promo key rides inside the uid ("flash-promo.<key>") because the
  // Square metadata budget is already at its 10-entry worst case; the
  // burn path parses it back out (see consume-order-discounts.ts).
  let flashDiscounts: OrderDiscount[] | undefined;

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
              uid: flashPromoUid(flash.key),
              name: `Flash Sale ${flash.percentage}% Off`,
              type: "FIXED_AMOUNT",
              amountMoney: {
                amount,
                currency: BUSINESS.currency as Currency,
              },
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
        "[order-quote] flash promo skipped:",
        flashError instanceof Error ? flashError.message : flashError,
      );
    }
  }

  // ---- App-download promo (claim-gated per phone, one order, whole-order %).
  // EXCLUSIVE + better-of, same lane as flash: replaces the entire discount
  // set (bundle OR flash — whichever survived above) when it's worth more.
  // Auto-applied server-side — the grant is keyed by the signed-in customer's
  // phone (recipientPhone), verified here, so no trusted client flag is needed
  // and old app binaries still get it. Priced off AUTHORITATIVE catalog money
  // (drinksSubtotalCents), never client prices; skipped if the menu fetch
  // failed (priceMaps null), same fail-safe as the promos above.
  let appDownloadDiscounts: OrderDiscount[] | undefined;

  if (priceMaps) {
    try {
      const appDl = await getAppDownloadDiscountStatus(recipientPhone);
      if (appDl.available) {
        const otherDiscountsCents = [
          ...(welcomeDiscounts ?? []),
          ...(igFollowDiscounts ?? []),
          ...(tierDiscounts ?? []),
          ...(flashDiscounts ?? []),
        ].reduce((s, d) => s + d.amountMoney.amount, 0n);
        let base = drinksSubtotalCents - rewardCupsSumCents;
        if (base < 0n) base = 0n;
        const amount = (base * BigInt(appDl.percentage || 20)) / 100n;
        if (amount > 0n && amount > otherDiscountsCents) {
          appDownloadDiscounts = [
            {
              uid: "app-download-discount",
              name: `App Download ${appDl.percentage || 20}% Off`,
              type: "FIXED_AMOUNT",
              amountMoney: {
                amount,
                currency: BUSINESS.currency as Currency,
              },
              scope: "ORDER",
            },
          ];
          // Exclusive: replace the whole bundle + flash. Zero the covered
          // counts too so the order metadata never claims a discount that
          // isn't attached (the burn paths gate on the discount uid, but the
          // metadata must not lie).
          welcomeDiscounts = undefined;
          igFollowDiscounts = undefined;
          tierDiscounts = undefined;
          flashDiscounts = undefined;
          welcomeDrinksCovered = 0;
          igFollowDrinksCovered = 0;
          tierToppingsCovered = 0;
        }
      }
    } catch (appDlError) {
      console.error(
        "[order-quote] app-download promo skipped:",
        appDlError instanceof Error ? appDlError.message : appDlError,
      );
    }
  }

  // ---- Tasting promo (one named drink at a flat price, app-only, date window).
  // ITEM-level, unlike everything above it: the amount is "what this cup costs
  // today minus the tasting price", computed from the AUTHORITATIVE variation
  // price (toppings excluded — the drink is $5, the pearls are not free).
  //
  // Same EXCLUSIVE + better-of lane as flash and app-download: the customer
  // gets the single largest discount, never two. That means a brand-new
  // customer's 30% welcome (or an unburned app-download ticket) can beat the
  // tasting price and win — they pay less than $5-off would have given them,
  // which is why the app copy promises "the best price", not "always $5".
  // See docs/adr/0009-tasting-promo.md.
  //
  // Web is excluded on purpose: the promo is the app's to give. Platform is
  // resolved from request headers server-side, so the body can't claim it.
  let tastingDiscounts: OrderDiscount[] | undefined;

  if (priceMaps && input.clientPlatform === "app") {
    try {
      const tasting = await getActiveTastingPromo(now);
      if (tasting.available && tasting.key && tasting.productName) {
        const otherDiscountsCents = [
          ...(welcomeDiscounts ?? []),
          ...(igFollowDiscounts ?? []),
          ...(tierDiscounts ?? []),
          ...(flashDiscounts ?? []),
          ...(appDownloadDiscounts ?? []),
        ].reduce((s, d) => s + d.amountMoney.amount, 0n);
        const { amountCents } = tastingDiscountFor({
          cups: authoritativeCups(lines, priceMaps),
          productName: tasting.productName,
          tastingPriceCents: tasting.tastingPriceCents,
          rewardCupCount: loyaltyRewardCount,
        });
        if (amountCents > 0n && amountCents > otherDiscountsCents) {
          tastingDiscounts = [
            {
              uid: tastingPromoUid(tasting.key),
              name: `${tasting.productName} Tasting Price`,
              type: "FIXED_AMOUNT",
              amountMoney: {
                amount: amountCents,
                currency: BUSINESS.currency as Currency,
              },
              scope: "ORDER",
            },
          ];
          // Exclusive: replace the whole bundle + flash + app-download. Zero
          // the covered counts too so the order metadata never claims a
          // discount that isn't attached (the burn paths gate on the discount
          // uid, but the metadata must not lie).
          welcomeDiscounts = undefined;
          igFollowDiscounts = undefined;
          tierDiscounts = undefined;
          flashDiscounts = undefined;
          appDownloadDiscounts = undefined;
          welcomeDrinksCovered = 0;
          igFollowDrinksCovered = 0;
          tierToppingsCovered = 0;
        }
      }
    } catch (tastingError) {
      console.error(
        "[order-quote] tasting promo skipped:",
        tastingError instanceof Error ? tastingError.message : tastingError,
      );
    }
  }

  const discounts = [
    ...(welcomeDiscounts ?? []),
    ...(igFollowDiscounts ?? []),
    ...(tierDiscounts ?? []),
    ...(flashDiscounts ?? []),
    ...(appDownloadDiscounts ?? []),
    ...(tastingDiscounts ?? []),
  ];

  // Annotate off the SURVIVING discounts, not off the branch that computed
  // them: flash and app-download each replace the whole tier bundle when they
  // win, and a note left over from a discount that lost would read as a perk
  // the customer isn't getting.
  const discountNotes: Record<string, string> = {};
  if (
    toppingsRemainingAfter != null &&
    discounts.some((d) => d.uid === "tier-topping-allowance")
  ) {
    discountNotes["tier-topping-allowance"] =
      `${toppingsRemainingAfter} left this month`;
  }

  // Note: loyalty rewards are NOT attached here. Square's order create request
  // has no loyaltyRewards field — the discount is applied by calling
  // CreateLoyaltyReward with the orderId AFTER the order exists. The checkout
  // flow does that step right after the create route returns.

  // Public-holiday surcharge is detected server-side (never trust client).
  // Ordered BEFORE card-surcharge so receipts list PH first.
  // Card surcharge is skipped when a loyalty reward fully covers the order
  // (no card charged → nothing to pass through). The PH surcharge follows
  // the same rule: a fully-redeemed free drink skips both.
  const activePH = getActivePublicHoliday(now);
  const skipSurcharges =
    (input.loyaltyRewardCount ?? 0) > 0 || input.applyLoyaltyReward === true;

  const serviceCharges: OrderServiceCharge[] = [];

  if (!skipSurcharges && activePH) {
    console.log(`[order-quote] PH surcharge attached: ${activePH.name}`);
    serviceCharges.push({
      uid: "public-holiday-surcharge",
      name: `${PH_SURCHARGE.name} (${activePH.name})`,
      percentage: PH_SURCHARGE.percentage,
      calculationPhase: "SUBTOTAL_PHASE",
      taxable: false,
    });
  }

  if (!skipSurcharges) {
    serviceCharges.push({
      uid: "platform-fee",
      name: PLATFORM_FEE.name,
      percentage: PLATFORM_FEE.percentage,
      calculationPhase: "SUBTOTAL_PHASE",
      taxable: false,
    });

    serviceCharges.push({
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
  const attachedDiscountsCents = discounts.reduce(
    (s, d) => s + d.amountMoney.amount,
    0n,
  );
  const paidDrinksCents = paidDrinksSubtotalCents(
    drinksSubtotalCents,
    attachedDiscountsCents + rewardCupsSumCents,
  );
  if (isDelivery && input.delivery) {
    const distKm = distanceKm(STORE_COORDS, {
      lat: input.delivery.lat,
      lng: input.delivery.lng,
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
      serviceCharges.push({
        uid: "delivery-fee",
        name: DELIVERY_FEE_NAME,
        amountMoney: { amount: fee, currency: BUSINESS.currency as Currency },
        calculationPhase: "SUBTOTAL_PHASE",
        taxable: false,
      });
    }
    const svc = serviceFeeCents(paidDrinksCents);
    if (svc > 0n) {
      serviceCharges.push({
        uid: "service-fee",
        name: `${SERVICE_FEE.name} (${SERVICE_FEE.percentage}%)`,
        amountMoney: { amount: svc, currency: BUSINESS.currency as Currency },
        calculationPhase: "SUBTOTAL_PHASE",
        taxable: false,
      });
    }
  }

  return {
    drinksSubtotalCents,
    rewardCupsSumCents,
    discounts,
    discountNotes,
    serviceCharges,
    welcomeDrinksCovered,
    igFollowDrinksCovered,
    tierToppingsCovered,
    skipSurcharges,
  };
}
