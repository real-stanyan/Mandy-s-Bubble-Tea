import { describe, expect, it } from "vitest";
import { applyPrizeToOrder } from "./auto-apply";
import type { DigitalPayload } from "./types";

const LINE_ITEMS = [
  {
    uid: "li-1",
    name: "Pearl Milk Tea",
    quantity: "1",
    base_price_money: { amount: 850, currency: "AUD" },
    modifiers: [] as Array<unknown>,
  },
  {
    uid: "li-2",
    name: "Taro Milk Tea",
    quantity: "1",
    base_price_money: { amount: 950, currency: "AUD" },
    modifiers: [] as Array<unknown>,
  },
];

describe("applyPrizeToOrder — discount", () => {
  it("appends an OrderLineItemDiscount of type FIXED_AMOUNT", () => {
    const payload: DigitalPayload = { kind: "discount", amount_cents: 300 };
    const result = applyPrizeToOrder(LINE_ITEMS, payload, "lottery-rollid-1");
    expect(result.discounts).toHaveLength(1);
    expect(result.discounts[0]).toMatchObject({
      type: "FIXED_AMOUNT",
      amount_money: { amount: 300, currency: "AUD" },
      scope: "ORDER",
    });
    expect(result.lineItems).toEqual(LINE_ITEMS);
  });
});

describe("applyPrizeToOrder — free_modifier", () => {
  it("appends a $0 modifier to the first line item", () => {
    const payload: DigitalPayload = {
      kind: "free_modifier",
      modifier_id: "mod_pearls",
    };
    const result = applyPrizeToOrder(LINE_ITEMS, payload, "lottery-rollid-2");
    expect(result.lineItems[0]?.modifiers).toEqual([
      {
        catalog_object_id: "mod_pearls",
        base_price_money: { amount: 0, currency: "AUD" },
      },
    ]);
    expect(result.lineItems[1]?.modifiers).toEqual([]);
    expect(result.discounts).toEqual([]);
  });
});

describe("applyPrizeToOrder — free_drink", () => {
  it("attaches a line-item-scoped FIXED_AMOUNT discount on the most expensive drink, capped at max_cents", () => {
    const payload: DigitalPayload = { kind: "free_drink", max_cents: 1000 };
    const result = applyPrizeToOrder(LINE_ITEMS, payload, "lottery-rollid-3");
    expect(result.discounts).toHaveLength(1);
    expect(result.discounts[0]).toMatchObject({
      uid: "discount-lottery-rollid-3",
      type: "FIXED_AMOUNT",
      amount_money: { amount: 950, currency: "AUD" },
      scope: "LINE_ITEM",
    });
    expect(result.lineItems[1]?.applied_discounts).toEqual([
      { discount_uid: "discount-lottery-rollid-3" },
    ]);
    expect(result.lineItems[0]?.applied_discounts).toBeUndefined();
  });

  it("caps amount at max_cents when most expensive drink is more expensive", () => {
    const expensive = [
      {
        uid: "li-1",
        name: "Premium",
        quantity: "1",
        base_price_money: { amount: 1500, currency: "AUD" },
        modifiers: [] as Array<unknown>,
      },
    ];
    const payload: DigitalPayload = { kind: "free_drink", max_cents: 1000 };
    const result = applyPrizeToOrder(expensive, payload, "rollid-4");
    expect(result.discounts[0]?.amount_money).toEqual({ amount: 1000, currency: "AUD" });
  });

  it("respects quantity > 1 by considering unit price only (per spec — first matching line)", () => {
    const multi = [
      {
        uid: "li-1",
        name: "Drink",
        quantity: "3",
        base_price_money: { amount: 800, currency: "AUD" },
        modifiers: [] as Array<unknown>,
      },
    ];
    const payload: DigitalPayload = { kind: "free_drink", max_cents: 5000 };
    const result = applyPrizeToOrder(multi, payload, "rollid-5");
    expect(result.discounts[0]?.amount_money).toEqual({ amount: 800, currency: "AUD" });
  });
});
