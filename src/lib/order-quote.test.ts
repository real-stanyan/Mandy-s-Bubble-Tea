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
vi.mock("@/lib/loyalty", () => ({ findLoyaltyAccountByPhone: vi.fn() }));
vi.mock("@/lib/tier-toppings-store", () => ({
  getToppingAllowanceStatus: vi.fn(),
}));
vi.mock("@/lib/holiday", () => ({ getActivePublicHoliday: vi.fn() }));

import { getWelcomeDiscountStatus } from "@/lib/supabase";
import { getIgFollowDiscountStatus } from "@/lib/ig-follow-discount";
import { getFlashPromoStatus } from "@/lib/flash-promo";
import { getAppDownloadDiscountStatus } from "@/lib/app-download-discount";
import { findLoyaltyAccountByPhone } from "@/lib/loyalty";
import { getToppingAllowanceStatus } from "@/lib/tier-toppings-store";
import { getActivePublicHoliday } from "@/lib/holiday";
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
  vi.mocked(findLoyaltyAccountByPhone).mockResolvedValue(null);
  vi.mocked(getToppingAllowanceStatus).mockResolvedValue({
    remaining: 0,
    usedCount: 0,
    monthKey: "2026-07",
  });
  vi.mocked(getActivePublicHoliday).mockReturnValue(null);
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
