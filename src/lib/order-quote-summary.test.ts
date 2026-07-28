import { describe, it, expect } from "vitest";
import type { Order } from "square";
import { summarizeQuote } from "./order-quote-summary";
import type { OrderPricing } from "./order-quote";

const AUD = "AUD" as const;

function pricing(over: Partial<OrderPricing> = {}): OrderPricing {
  return {
    drinksSubtotalCents: 5600n,
    rewardCupsSumCents: 0n,
    discounts: [],
    serviceCharges: [],
    welcomeDrinksCovered: 0,
    igFollowDrinksCovered: 0,
    tierToppingsCovered: 0,
    skipSurcharges: false,
    ...over,
  };
}

const appDownload = {
  uid: "app-download-discount",
  name: "App Download 20% Off",
  type: "FIXED_AMOUNT" as const,
  amountMoney: { amount: 1120n, currency: AUD },
  scope: "ORDER" as const,
};

const percentageCharges = [
  {
    uid: "platform-fee",
    name: "Platform Fee",
    percentage: "0.5",
    calculationPhase: "SUBTOTAL_PHASE" as const,
    taxable: false,
  },
  {
    uid: "card-surcharge",
    name: "Card Surcharge",
    percentage: "1.9",
    calculationPhase: "SUBTOTAL_PHASE" as const,
    taxable: false,
  },
];

describe("summarizeQuote", () => {
  // Shape and figures taken from a real orders.calculate response (2026-07-28):
  // Square reports line items NET of the order discount, and sizes the
  // percentage charges on that same net amount.
  it("reports Square's total verbatim when calculate answered", () => {
    const calculated = {
      lineItems: [
        {
          grossSalesMoney: { amount: 4480n, currency: AUD },
          totalMoney: { amount: 4480n, currency: AUD },
        },
      ],
      serviceCharges: [
        { uid: "platform-fee", totalMoney: { amount: 22n, currency: AUD } },
        { uid: "card-surcharge", totalMoney: { amount: 85n, currency: AUD } },
      ],
      totalMoney: { amount: 4587n, currency: AUD },
    } as unknown as Order;

    const summary = summarizeQuote(
      pricing({ discounts: [appDownload], serviceCharges: percentageCharges }),
      calculated,
    );

    expect(summary.estimated).toBe(false);
    // The PRE-discount subtotal, from our own catalog money. Square's 4480 is
    // already net of the 1120 discount, so reusing it here would show the
    // discount twice.
    expect(summary.subtotalCents).toBe("5600");
    expect(summary.totalCents).toBe("4587");
    // 85 is Square's round-half-up of 1.9% × 4480 = 85.12 → 85; the local floor
    // agrees here but not always, which is why we ask.
    expect(summary.serviceCharges).toEqual([
      { uid: "platform-fee", name: "Platform Fee", amountCents: "22" },
      { uid: "card-surcharge", name: "Card Surcharge", amountCents: "85" },
    ]);
    expect(summary.discounts).toEqual([
      {
        uid: "app-download-discount",
        name: "App Download 20% Off",
        amountCents: "1120",
      },
    ]);
  });

  it("computes percentage charges itself when calculate is unavailable", () => {
    const summary = summarizeQuote(
      pricing({ discounts: [appDownload], serviceCharges: percentageCharges }),
      null,
    );

    expect(summary.estimated).toBe(true);
    // Post-discount base (5600 − 1120 = 4480), matching Square: 0.5% → 22.4 and
    // 1.9% → 85.12, both floored.
    expect(summary.serviceCharges.map((s) => s.amountCents)).toEqual([
      "22",
      "85",
    ]);
    // 5600 − 1120 + 22 + 85
    expect(summary.totalCents).toBe("4587");
  });

  it("keeps a fixed-amount charge's own money in the fallback", () => {
    const summary = summarizeQuote(
      pricing({
        serviceCharges: [
          {
            uid: "delivery-fee",
            name: "Delivery Fee",
            amountMoney: { amount: 599n, currency: AUD },
            calculationPhase: "SUBTOTAL_PHASE",
            taxable: false,
          },
        ],
      }),
      null,
    );
    expect(summary.serviceCharges[0].amountCents).toBe("599");
    expect(summary.serviceChargeTotalCents).toBe("599");
  });

  it("nets the loyalty reward off the Square total", () => {
    const calculated = {
      lineItems: [{ totalMoney: { amount: 1240n, currency: AUD } }],
      totalMoney: { amount: 1240n, currency: AUD },
    } as unknown as Order;

    const summary = summarizeQuote(
      pricing({ drinksSubtotalCents: 1240n, rewardCupsSumCents: 620n }),
      calculated,
    );
    expect(summary.totalCents).toBe("1240");
    expect(summary.rewardCupsSumCents).toBe("620");
    expect(summary.netTotalCents).toBe("620");
  });

  it("floors the net total at zero when the reward covers everything", () => {
    const summary = summarizeQuote(
      pricing({ drinksSubtotalCents: 620n, rewardCupsSumCents: 620n }),
      null,
    );
    expect(summary.netTotalCents).toBe("0");
  });

  // A menu-cache outage leaves priceMaps null, so every discount is skipped and
  // the subtotal comes from client prices. The summary must still answer.
  it("always reports the pricing subtotal, never Square's net line items", () => {
    const summary = summarizeQuote(pricing({ drinksSubtotalCents: 700n }), {
      lineItems: [{ totalMoney: { amount: 123n, currency: AUD } }],
      totalMoney: { amount: 700n, currency: AUD },
    } as unknown as Order);
    expect(summary.subtotalCents).toBe("700");
  });
});
