import { describe, it, expect, vi, beforeEach } from "vitest";

// The discount ladder is the part of pricing that money depends on and that no
// test covered while it lived inline in the orders route. Now that both the
// create route and /api/orders/quote go through this one function, a change
// here moves the charge AND the quote together — these tests pin the rules.

vi.mock("@/lib/supabase", () => ({ getWelcomeDiscountStatus: vi.fn() }));
vi.mock("@/lib/ig-follow-discount", () => ({
  getIgFollowDiscountStatus: vi.fn(),
}));
vi.mock("@/lib/flash-promo", () => ({
  getFlashPromoStatus: vi.fn(),
  flashPromoUid: (key: string) => `flash-promo.${key}`,
}));
vi.mock("@/lib/app-download-discount", () => ({
  getAppDownloadDiscountStatus: vi.fn(),
}));
// Only the DB lookup is mocked — the tasting money math itself is the real
// implementation, so these tests pin how it lands in the discount ladder.
vi.mock("@/lib/tasting-promo", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/tasting-promo")>(
      "@/lib/tasting-promo",
    );
  return { ...actual, getActiveTastingPromo: vi.fn() };
});
vi.mock("@/lib/loyalty", () => ({ findLoyaltyAccountByPhone: vi.fn() }));
vi.mock("@/lib/tier-toppings-store", () => ({
  getToppingAllowanceStatus: vi.fn(),
}));
vi.mock("@/lib/holiday", () => ({ getActivePublicHoliday: vi.fn() }));
// Fully stubbed (no importActual): the real module pulls in supabase-server
// at module scope, which this test file deliberately runs without.
vi.mock("@/lib/mystery-box", () => ({
  getLiveMysteryCoupons: vi.fn().mockResolvedValue([]),
  mysteryCouponUid: (id: string) => `mystery-coupon.${id}`,
}));

import { getWelcomeDiscountStatus } from "@/lib/supabase";
import { getIgFollowDiscountStatus } from "@/lib/ig-follow-discount";
import { getFlashPromoStatus } from "@/lib/flash-promo";
import { getAppDownloadDiscountStatus } from "@/lib/app-download-discount";
import { getActiveTastingPromo } from "@/lib/tasting-promo";
import { findLoyaltyAccountByPhone } from "@/lib/loyalty";
import { getToppingAllowanceStatus } from "@/lib/tier-toppings-store";
import { getActivePublicHoliday } from "@/lib/holiday";
import { getLiveMysteryCoupons } from "@/lib/mystery-box";
import { computeOrderPricing, type QuoteLine } from "./order-quote";
import type { AuthoritativePriceMaps } from "./order-pricing";

const VARIATION = "VAR_MILK_TEA";

/** 8 cups at A$7.00 → A$56.00 subtotal, no modifiers. */
const lines: QuoteLine[] = [
  { variationId: VARIATION, variationPriceCents: 700, modifiers: [], quantity: 8 },
];

const priceMaps: AuthoritativePriceMaps = {
  variationPriceById: new Map([[VARIATION, 700n]]),
  modifierPriceById: new Map(),
  itemNameByVariationId: new Map([[VARIATION, "Classic Milk Tea"]]),
};

const base = {
  lines,
  isDelivery: false,
  customerId: "CUST_1",
  recipientPhone: "+61400000001",
  priceMaps,
};

const none = { available: false, percentage: 0, drinksRemaining: 0 };

function uids(discounts: Array<{ uid: string }>) {
  return discounts.map((d) => d.uid);
}
function amountOf(
  discounts: Array<{ uid: string; amountMoney: { amount: bigint } }>,
  uid: string,
) {
  return discounts.find((d) => d.uid === uid)?.amountMoney.amount;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getWelcomeDiscountStatus).mockResolvedValue(none);
  vi.mocked(getIgFollowDiscountStatus).mockResolvedValue({
    ...none,
    claimedAt: null,
    redeemedAt: null,
  });
  vi.mocked(getFlashPromoStatus).mockResolvedValue({
    available: false,
    percentage: 0,
    key: null,
  });
  vi.mocked(getAppDownloadDiscountStatus).mockResolvedValue({
    available: false,
    percentage: 0,
    claimedAt: null,
    redeemedAt: null,
  });
  vi.mocked(getActiveTastingPromo).mockResolvedValue({
    available: false,
    key: null,
    productName: null,
    tastingPriceCents: 0,
    endsAt: null,
  });
  vi.mocked(findLoyaltyAccountByPhone).mockResolvedValue(null);
  vi.mocked(getToppingAllowanceStatus).mockResolvedValue({
    remaining: 0,
    usedCount: 0,
    monthKey: "2026-07",
  });
  vi.mocked(getActivePublicHoliday).mockReturnValue(null);
  vi.mocked(getLiveMysteryCoupons).mockResolvedValue([]);
});

describe("computeOrderPricing — discount ladder", () => {
  it("prices the cart from catalog money, not the client body", async () => {
    const forged: QuoteLine[] = [
      // Client claims A$99 a cup; the catalog says A$7.
      { variationId: VARIATION, variationPriceCents: 9900, modifiers: [], quantity: 8 },
    ];
    const p = await computeOrderPricing({ ...base, lines: forged });
    expect(p.drinksSubtotalCents).toBe(5600n);
  });

  it("attaches the welcome discount only when Supabase confirms it", async () => {
    vi.mocked(getWelcomeDiscountStatus).mockResolvedValue({
      available: true,
      percentage: 30,
      drinksRemaining: 2,
    });
    const p = await computeOrderPricing({
      ...base,
      applyWelcomeDiscount: true,
    });
    // 2 cups × A$7 × 30% = A$4.20
    expect(amountOf(p.discounts, "welcome-discount")).toBe(420n);
    expect(p.welcomeDrinksCovered).toBe(2);
  });

  it("ignores a client asking for a welcome discount it doesn't have", async () => {
    const p = await computeOrderPricing({
      ...base,
      applyWelcomeDiscount: true,
    });
    expect(p.discounts).toEqual([]);
  });

  it("never gives the welcome discount to a delivery order", async () => {
    vi.mocked(getWelcomeDiscountStatus).mockResolvedValue({
      available: true,
      percentage: 30,
      drinksRemaining: 2,
    });
    const p = await computeOrderPricing({
      ...base,
      applyWelcomeDiscount: true,
      isDelivery: true,
      delivery: { lat: -27.96, lng: 153.4 },
    });
    expect(uids(p.discounts)).not.toContain("welcome-discount");
  });

  it("lets the app-download 20% replace a smaller welcome bundle", async () => {
    vi.mocked(getWelcomeDiscountStatus).mockResolvedValue({
      available: true,
      percentage: 30,
      drinksRemaining: 2,
    });
    vi.mocked(getAppDownloadDiscountStatus).mockResolvedValue({
      available: true,
      percentage: 20,
      claimedAt: "2026-07-27T00:00:00Z",
      redeemedAt: null,
    });
    const p = await computeOrderPricing({
      ...base,
      applyWelcomeDiscount: true,
    });
    // A$11.20 (20% of 56) beats A$4.20, and replaces it outright.
    expect(uids(p.discounts)).toEqual(["app-download-discount"]);
    expect(amountOf(p.discounts, "app-download-discount")).toBe(1120n);
    // The metadata counts must not claim a discount that isn't attached.
    expect(p.welcomeDrinksCovered).toBe(0);
  });

  it("keeps the bundle when app-download would be worth less", async () => {
    // 8 cups, all 8 covered at 30% = A$16.80 > 20% of the order = A$11.20.
    vi.mocked(getWelcomeDiscountStatus).mockResolvedValue({
      available: true,
      percentage: 30,
      drinksRemaining: 8,
    });
    vi.mocked(getAppDownloadDiscountStatus).mockResolvedValue({
      available: true,
      percentage: 20,
      claimedAt: "2026-07-27T00:00:00Z",
      redeemedAt: null,
    });
    const p = await computeOrderPricing({
      ...base,
      applyWelcomeDiscount: true,
    });
    expect(uids(p.discounts)).toEqual(["welcome-discount"]);
    expect(amountOf(p.discounts, "welcome-discount")).toBe(1680n);
  });

  it("puts app-download above flash when both are available", async () => {
    vi.mocked(getFlashPromoStatus).mockResolvedValue({
      available: true,
      percentage: 15,
      key: "2026-07-28",
    });
    vi.mocked(getAppDownloadDiscountStatus).mockResolvedValue({
      available: true,
      percentage: 20,
      claimedAt: "2026-07-27T00:00:00Z",
      redeemedAt: null,
    });
    const p = await computeOrderPricing(base);
    expect(uids(p.discounts)).toEqual(["app-download-discount"]);
  });

  it("keeps a bigger flash promo over app-download", async () => {
    vi.mocked(getFlashPromoStatus).mockResolvedValue({
      available: true,
      percentage: 30,
      key: "2026-07-28",
    });
    vi.mocked(getAppDownloadDiscountStatus).mockResolvedValue({
      available: true,
      percentage: 20,
      claimedAt: "2026-07-27T00:00:00Z",
      redeemedAt: null,
    });
    const p = await computeOrderPricing(base);
    expect(uids(p.discounts)).toEqual(["flash-promo.2026-07-28"]);
  });

  it("skips every discount when the menu cache is down", async () => {
    vi.mocked(getAppDownloadDiscountStatus).mockResolvedValue({
      available: true,
      percentage: 20,
      claimedAt: "2026-07-27T00:00:00Z",
      redeemedAt: null,
    });
    const p = await computeOrderPricing({ ...base, priceMaps: null });
    expect(p.discounts).toEqual([]);
    // Fees still need a subtotal, so client prices are the fallback there.
    expect(p.drinksSubtotalCents).toBe(5600n);
  });

  it("prices app-download off the subtotal minus reward cups", async () => {
    vi.mocked(getAppDownloadDiscountStatus).mockResolvedValue({
      available: true,
      percentage: 20,
      claimedAt: "2026-07-27T00:00:00Z",
      redeemedAt: null,
    });
    const p = await computeOrderPricing({ ...base, loyaltyRewardCount: 1 });
    expect(p.rewardCupsSumCents).toBe(700n);
    // 20% of (5600 − 700), never of the full 5600.
    expect(amountOf(p.discounts, "app-download-discount")).toBe(980n);
  });
});

describe("computeOrderPricing — service charges", () => {
  it("attaches platform fee and card surcharge on a normal order", async () => {
    const p = await computeOrderPricing(base);
    expect(p.serviceCharges.map((s) => s.uid)).toEqual([
      "platform-fee",
      "card-surcharge",
    ]);
    expect(p.skipSurcharges).toBe(false);
  });

  it("drops the surcharges when a loyalty reward is redeemed", async () => {
    const p = await computeOrderPricing({ ...base, loyaltyRewardCount: 1 });
    expect(p.serviceCharges).toEqual([]);
    expect(p.skipSurcharges).toBe(true);
  });

  it("adds the public-holiday surcharge first, before the other two", async () => {
    vi.mocked(getActivePublicHoliday).mockReturnValue({
      name: "Christmas Day",
      date: "2026-12-25",
    });
    const p = await computeOrderPricing(base);
    expect(p.serviceCharges.map((s) => s.uid)).toEqual([
      "public-holiday-surcharge",
      "platform-fee",
      "card-surcharge",
    ]);
  });

  it("charges delivery and service fees on a delivery order", async () => {
    const p = await computeOrderPricing({
      ...base,
      isDelivery: true,
      delivery: { lat: -27.9, lng: 153.35 },
    });
    const uidList = p.serviceCharges.map((s) => s.uid);
    expect(uidList).toContain("service-fee");
  });
});

describe("computeOrderPricing — Diamond free-topping note", () => {
  const TOPPING = "MOD_PEARLS";
  // Diamond, one cup, one paid topping.
  const diamondBase = {
    ...base,
    lines: [
      {
        variationId: VARIATION,
        variationPriceCents: 700,
        modifiers: [{ id: TOPPING, priceCents: 80 }],
        quantity: 2,
      },
    ] as QuoteLine[],
    priceMaps: {
      variationPriceById: new Map([[VARIATION, 780n]]),
      modifierPriceById: new Map([[TOPPING, 80n]]),
      itemNameByVariationId: new Map([[VARIATION, "Classic Milk Tea"]]),
    },
  };

  function asDiamondWith(remaining: number) {
    vi.mocked(findLoyaltyAccountByPhone).mockResolvedValue({
      lifetimePoints: 100,
    } as Awaited<ReturnType<typeof findLoyaltyAccountByPhone>>);
    vi.mocked(getToppingAllowanceStatus).mockResolvedValue({
      remaining,
      usedCount: 0,
      monthKey: "2026-07",
    });
  }

  it("annotates the allowance row with what is left AFTER this order", async () => {
    asDiamondWith(5);
    const p = await computeOrderPricing(diamondBase);
    // 2 paid toppings covered out of 5 remaining → 3 left, not 5. Pre-order
    // was the old mirror's number and read as a promise it didn't make.
    expect(p.discountNotes["tier-topping-allowance"]).toBe("3 left this month");
  });

  it("says 0 left when this order consumes the whole allowance", async () => {
    asDiamondWith(2);
    const p = await computeOrderPricing(diamondBase);
    expect(p.discountNotes["tier-topping-allowance"]).toBe("0 left this month");
  });

  it("keeps the note out of the discount handed to Square", async () => {
    asDiamondWith(5);
    const p = await computeOrderPricing(diamondBase);
    const row = p.discounts.find((d) => d.uid === "tier-topping-allowance");
    // The name reaches the customer's receipt a week later, where "3 left this
    // month" is no longer true.
    expect(row?.name).toBe("Diamond Free Toppings (2)");
    expect(Object.values(row ?? {}).join(" ")).not.toContain("left this month");
  });

  it("drops the note when a better promo replaces the tier bundle", async () => {
    asDiamondWith(5);
    vi.mocked(getAppDownloadDiscountStatus).mockResolvedValue({
      available: true,
      percentage: 20,
      claimedAt: null,
      redeemedAt: null,
    });
    const p = await computeOrderPricing(diamondBase);
    // app-download is exclusive: no free-topping row survives, so a leftover
    // note would advertise a perk this order isn't getting.
    expect(uids(p.discounts)).toEqual(["app-download-discount"]);
    expect(p.discountNotes["tier-topping-allowance"]).toBeUndefined();
  });

  it("has no note at all for a member with no free toppings applied", async () => {
    asDiamondWith(0);
    const p = await computeOrderPricing(diamondBase);
    expect(p.discountNotes).toEqual({});
  });
});

describe("computeOrderPricing — tasting promo", () => {
  const TASTING_VAR = "VAR_STRAWBERRY_MATCHA";
  const PRODUCT = "Strawberry Matcha Milk Tea";

  // One $8.50 promo drink + one $7.00 other drink.
  const tastingBase = {
    lines: [
      { variationId: TASTING_VAR, variationPriceCents: 850, modifiers: [], quantity: 1 },
      { variationId: VARIATION, variationPriceCents: 700, modifiers: [], quantity: 1 },
    ] as QuoteLine[],
    isDelivery: false,
    customerId: "CUST_1",
    recipientPhone: "+61400000001",
    priceMaps: {
      variationPriceById: new Map([
        [TASTING_VAR, 850n],
        [VARIATION, 700n],
      ]),
      modifierPriceById: new Map<string, bigint>(),
      itemNameByVariationId: new Map([
        [TASTING_VAR, PRODUCT],
        [VARIATION, "Classic Milk Tea"],
      ]),
    },
    clientPlatform: "app" as const,
  };

  function promoIsLive() {
    vi.mocked(getActiveTastingPromo).mockResolvedValue({
      available: true,
      key: "strawberry-matcha-2026-08",
      productName: PRODUCT,
      tastingPriceCents: 500,
      endsAt: "2026-08-12T05:00:00Z",
    });
  }

  it("brings the promo drink down to the tasting price, and nothing else", async () => {
    promoIsLive();
    const p = await computeOrderPricing(tastingBase);
    expect(uids(p.discounts)).toEqual([
      "tasting-promo.strawberry-matcha-2026-08",
    ]);
    // 850 - 500 on the promo cup; the $7.00 cup is untouched.
    expect(amountOf(p.discounts, "tasting-promo.strawberry-matcha-2026-08")).toBe(
      350n,
    );
  });

  it("is app-only — the same cart on the web gets no tasting price", async () => {
    promoIsLive();
    const p = await computeOrderPricing({
      ...tastingBase,
      clientPlatform: "web",
    });
    expect(p.discounts).toEqual([]);
    // Not even asked for: web must not pay for the lookup either.
    expect(getActiveTastingPromo).not.toHaveBeenCalled();
  });

  it("defaults to web when the caller says nothing", async () => {
    promoIsLive();
    const { clientPlatform: _omitted, ...noPlatform } = tastingBase;
    const p = await computeOrderPricing(noPlatform);
    expect(p.discounts).toEqual([]);
  });

  it("stays out of the way when a bigger discount already applies", async () => {
    promoIsLive();
    // Welcome 30% on both cups = 465c > the 350c tasting saving.
    vi.mocked(getWelcomeDiscountStatus).mockResolvedValue({
      available: true,
      percentage: 30,
      drinksRemaining: 2,
    });
    const p = await computeOrderPricing({
      ...tastingBase,
      applyWelcomeDiscount: true,
    });
    expect(uids(p.discounts)).toEqual(["welcome-discount"]);
    expect(p.welcomeDrinksCovered).toBe(2);
  });

  it("replaces the whole bundle when it is the better deal", async () => {
    promoIsLive();
    // Welcome on one cup only = 210c < the 350c tasting saving.
    vi.mocked(getWelcomeDiscountStatus).mockResolvedValue({
      available: true,
      percentage: 30,
      drinksRemaining: 1,
    });
    const p = await computeOrderPricing({
      ...tastingBase,
      applyWelcomeDiscount: true,
    });
    expect(uids(p.discounts)).toEqual([
      "tasting-promo.strawberry-matcha-2026-08",
    ]);
    // The metadata must not claim a welcome drink the order didn't get.
    expect(p.welcomeDrinksCovered).toBe(0);
  });

  it("never discounts a cup a loyalty star already made free", async () => {
    promoIsLive();
    // One reward cup takes the cheapest ($7.00); the promo cup survives.
    const p = await computeOrderPricing({
      ...tastingBase,
      loyaltyRewardCount: 1,
    });
    expect(amountOf(p.discounts, "tasting-promo.strawberry-matcha-2026-08")).toBe(
      350n,
    );
    // Two reward cups swallow the promo cup too — nothing left to discount.
    const both = await computeOrderPricing({
      ...tastingBase,
      loyaltyRewardCount: 2,
    });
    expect(both.discounts).toEqual([]);
  });

  it("prices without the promo when the menu cache is down", async () => {
    promoIsLive();
    const p = await computeOrderPricing({ ...tastingBase, priceMaps: null });
    expect(p.discounts).toEqual([]);
  });

  it("survives a promo lookup failure", async () => {
    vi.mocked(getActiveTastingPromo).mockRejectedValue(new Error("supabase down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const p = await computeOrderPricing(tastingBase);
    expect(p.discounts).toEqual([]);
    expect(p.drinksSubtotalCents).toBe(1550n);
    spy.mockRestore();
  });
});

describe("computeOrderPricing — bulk order brackets (exclusive by policy)", () => {
  /** N cups at A$7.00. */
  const cups = (n: number): QuoteLine[] => [
    { variationId: VARIATION, variationPriceCents: 700, modifiers: [], quantity: n },
  ];

  it("attaches the bracket discount on 10+ cups", async () => {
    const p = await computeOrderPricing({ ...base, lines: cups(10) });
    expect(uids(p.discounts)).toEqual(["bulk-order-discount"]);
    // 10 × $7.00 = $70.00 → 10% = $7.00
    expect(amountOf(p.discounts, "bulk-order-discount")).toBe(700n);
    expect(p.discounts[0].name).toContain("10% Off");
    expect(p.discounts[0].name).toContain("10 cups");
  });

  it("steps the brackets at 20 and 30 cups", async () => {
    const p20 = await computeOrderPricing({ ...base, lines: cups(20) });
    expect(amountOf(p20.discounts, "bulk-order-discount")).toBe(2100n); // 15% of $140
    const p30 = await computeOrderPricing({ ...base, lines: cups(30) });
    expect(amountOf(p30.discounts, "bulk-order-discount")).toBe(4200n); // 20% of $210
  });

  it("gives nothing at 9 cups and nothing above the self-serve ceiling", async () => {
    const p9 = await computeOrderPricing({ ...base, lines: cups(9) });
    expect(p9.discounts).toEqual([]);
    // 51+ never reaches pricing in production (/api/orders refuses first);
    // if it does, no bracket applies rather than a wrong one.
    const p51 = await computeOrderPricing({ ...base, lines: cups(51) });
    expect(p51.discounts).toEqual([]);
  });

  it("replaces a flash promo even when the flash would be worth more — policy, not better-of", async () => {
    vi.mocked(getFlashPromoStatus).mockResolvedValue({
      available: true,
      percentage: 25,
      key: "flash-today",
    });
    const p = await computeOrderPricing({ ...base, lines: cups(10) });
    // Flash 25% ($17.50) beats bulk 10% ($7.00) on money, and loses anyway:
    // the bulk buyer's bracket is the whole deal (Stan, 2026-08-17).
    expect(uids(p.discounts)).toEqual(["bulk-order-discount"]);
    expect(amountOf(p.discounts, "bulk-order-discount")).toBe(700n);
  });

  it("takes loyalty-reward cups off the bulk base — a free cup is never also 10%-off", async () => {
    const p = await computeOrderPricing({
      ...base,
      lines: cups(10),
      loyaltyRewardCount: 2,
    });
    // Base = $70 − 2×$7 = $56 → 10% = $5.60
    expect(amountOf(p.discounts, "bulk-order-discount")).toBe(560n);
  });

  it("skips the bulk discount when the menu cache is down", async () => {
    const p = await computeOrderPricing({ ...base, lines: cups(10), priceMaps: null });
    expect(p.discounts).toEqual([]);
  });
});

describe("computeOrderPricing — mystery-box coupon lane", () => {
  const coupon = (over: Record<string, unknown> = {}) => ({
    id: "c-1",
    prize: "pct10" as const,
    percentage: 10,
    label: "10% Off Your Order",
    expiresAt: "2099-01-01T00:00:00.000Z",
    ...over,
  });

  it("applies the best live coupon as a whole-order discount with the id in the uid", async () => {
    vi.mocked(getLiveMysteryCoupons).mockResolvedValue([coupon()]);
    const p = await computeOrderPricing(base); // 8 × $7 = $56
    expect(uids(p.discounts)).toEqual(["mystery-coupon.c-1"]);
    expect(amountOf(p.discounts, "mystery-coupon.c-1")).toBe(560n); // 10%
    expect(p.discounts[0].name).toContain("Mystery Box");
  });

  it("picks the coupon worth most for THIS cart when several are live", async () => {
    vi.mocked(getLiveMysteryCoupons).mockResolvedValue([
      coupon({ id: "c-small", prize: "pct5", percentage: 5 }),
      coupon({ id: "c-big", prize: "pct15", percentage: 15 }),
    ]);
    const p = await computeOrderPricing(base);
    expect(uids(p.discounts)).toEqual(["mystery-coupon.c-big"]);
  });

  it("values a free drink at the cheapest non-reward cup", async () => {
    vi.mocked(getLiveMysteryCoupons).mockResolvedValue([
      coupon({ id: "c-drink", prize: "free_drink", percentage: null }),
    ]);
    const p = await computeOrderPricing(base);
    expect(amountOf(p.discounts, "mystery-coupon.c-drink")).toBe(700n);
  });

  it("a gift prize STACKS on the winning bundle instead of fighting it", async () => {
    // The bug Stan hit (2026-08-17): a Diamond member's free-topping prize
    // lost better-of to their own tier bundle every time — unusable. Gifts
    // now ride on top: welcome discount stays AND the free drink applies.
    vi.mocked(getWelcomeDiscountStatus).mockResolvedValue({
      available: true,
      percentage: 30,
      drinksRemaining: 8,
    });
    vi.mocked(getLiveMysteryCoupons).mockResolvedValue([
      coupon({ id: "c-drink", prize: "free_drink", percentage: null }),
    ]);
    const p = await computeOrderPricing({ ...base, applyWelcomeDiscount: true });
    expect(uids(p.discounts)).toEqual(["welcome-discount", "mystery-coupon.c-drink"]);
    expect(amountOf(p.discounts, "welcome-discount")).toBe(1680n);
    expect(amountOf(p.discounts, "mystery-coupon.c-drink")).toBe(700n);
    expect(p.welcomeDrinksCovered).toBe(8); // the bundle survived intact
  });

  it("an applicable gift outranks a pct coupon for the one-coupon slot", async () => {
    vi.mocked(getLiveMysteryCoupons).mockResolvedValue([
      coupon({ id: "c-big", prize: "pct15", percentage: 15 }),
      coupon({ id: "c-drink", prize: "free_drink", percentage: null }),
    ]);
    const p = await computeOrderPricing(base);
    // The gift stacks (pure upside); only ONE coupon may apply per order
    // because the burn path parses a single uid.
    expect(uids(p.discounts)).toEqual(["mystery-coupon.c-drink"]);
  });

  it("a free-topping coupon on a cart with no paid toppings stays in the pocket", async () => {
    vi.mocked(getLiveMysteryCoupons).mockResolvedValue([
      coupon({ id: "c-top", prize: "free_topping", percentage: null }),
    ]);
    const p = await computeOrderPricing(base); // no modifiers in the cart
    expect(p.discounts).toEqual([]);
  });

  it("loses to a flash promo worth more — better-of, unlike the bulk lane", async () => {
    vi.mocked(getLiveMysteryCoupons).mockResolvedValue([coupon()]); // 10% = $5.60
    vi.mocked(getFlashPromoStatus).mockResolvedValue({
      available: true,
      percentage: 20,
      key: "flash-today",
    }); // 20% = $11.20
    const p = await computeOrderPricing(base);
    expect(uids(p.discounts)).toEqual(["flash-promo.flash-today"]);
  });

  it("is itself replaced by the bulk bracket — policy beats prize", async () => {
    vi.mocked(getLiveMysteryCoupons).mockResolvedValue([
      coupon({ id: "c-big", prize: "pct15", percentage: 15 }),
    ]);
    const p = await computeOrderPricing({
      ...base,
      lines: [
        { variationId: VARIATION, variationPriceCents: 700, modifiers: [], quantity: 10 },
      ],
    });
    expect(uids(p.discounts)).toEqual(["bulk-order-discount"]);
  });
});
