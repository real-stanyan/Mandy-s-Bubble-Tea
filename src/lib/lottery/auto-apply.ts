import type { DigitalPayload } from "./types";

export interface SquareLineItem {
  uid?: string;
  name?: string;
  quantity: string;
  base_price_money: { amount: number; currency: string };
  modifiers: Array<unknown>;
  applied_discounts?: Array<{ discount_uid: string }>;
}

export interface SquareDiscount {
  uid: string;
  type: "FIXED_AMOUNT" | "FIXED_PERCENTAGE";
  name: string;
  amount_money?: { amount: number; currency: string };
  percentage?: string;
  scope: "ORDER" | "LINE_ITEM";
}

export interface ApplyResult {
  lineItems: SquareLineItem[];
  discounts: SquareDiscount[];
}

export function applyPrizeToOrder(
  lineItems: SquareLineItem[],
  payload: DigitalPayload,
  rollId: string,
): ApplyResult {
  const currency = lineItems[0]?.base_price_money.currency ?? "AUD";

  if (payload.kind === "discount") {
    return {
      lineItems,
      discounts: [
        {
          uid: `discount-${rollId}`,
          type: "FIXED_AMOUNT",
          name: "Lottery prize discount",
          amount_money: { amount: payload.amount_cents, currency },
          scope: "ORDER",
        },
      ],
    };
  }

  if (payload.kind === "free_modifier") {
    const updated = lineItems.map((li, idx) =>
      idx === 0
        ? {
            ...li,
            modifiers: [
              ...li.modifiers,
              {
                catalog_object_id: payload.modifier_id,
                base_price_money: { amount: 0, currency },
              },
            ],
          }
        : li,
    );
    return { lineItems: updated, discounts: [] };
  }

  // free_drink
  let bestIdx = 0;
  let bestPrice = -1;
  lineItems.forEach((li, idx) => {
    if (li.base_price_money.amount > bestPrice) {
      bestPrice = li.base_price_money.amount;
      bestIdx = idx;
    }
  });
  const discountAmount = Math.min(bestPrice, payload.max_cents);
  const discountUid = `discount-${rollId}`;
  const updated = lineItems.map((li, idx) =>
    idx === bestIdx
      ? {
          ...li,
          applied_discounts: [
            ...(li.applied_discounts ?? []),
            { discount_uid: discountUid },
          ],
        }
      : li,
  );
  return {
    lineItems: updated,
    discounts: [
      {
        uid: discountUid,
        type: "FIXED_AMOUNT",
        name: "Lottery free drink",
        amount_money: { amount: discountAmount, currency },
        scope: "LINE_ITEM",
      },
    ],
  };
}
