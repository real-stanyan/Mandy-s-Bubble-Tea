import { describe, it, expect } from "vitest";
import { isCustomAmountOnly } from "./custom-amount";

/**
 * Shapes taken from the real orders on Stan's account, 2026-08-15.
 */
describe("orders with nothing to show", () => {
  it("hides the POS custom-amount charge", () => {
    // Order wWZ2toCnNU: Point of Sale, A$0.10, ticket "60", one line with
    // no name and item_type CUSTOM_AMOUNT. Rendered as "1× Item" under
    // "#60", with a Reorder button that had nothing to reorder.
    expect(isCustomAmountOnly({ lineItems: [{ itemType: "CUSTOM_AMOUNT" }] })).toBe(
      true,
    );
  });

  it("keeps a real drink, however it was bought", () => {
    // Order ccViZz9PB5: the online Grapefruit Black Tea from the same day.
    // In-store purchases carry proper catalog lines too and must survive —
    // a customer's history is the reason the screen exists.
    expect(isCustomAmountOnly({ lineItems: [{ itemType: "ITEM" }] })).toBe(false);
  });

  it("keeps an order that mixes a drink with a custom amount", () => {
    // A surcharge or an off-menu extra alongside a real drink. There is
    // still a drink to show and to reorder, so it stays.
    expect(
      isCustomAmountOnly({
        lineItems: [{ itemType: "ITEM" }, { itemType: "CUSTOM_AMOUNT" }],
      }),
    ).toBe(false);
  });

  it("hides an order with no lines at all", () => {
    expect(isCustomAmountOnly({ lineItems: [] })).toBe(true);
    expect(isCustomAmountOnly({})).toBe(true);
    expect(isCustomAmountOnly({ lineItems: null })).toBe(true);
  });

  it("treats a line with no itemType as a real item", () => {
    // Errs toward showing. Hiding a purchase someone made is worse than
    // showing one they cannot reorder, and an absent field is not evidence
    // that the line was a custom amount.
    expect(isCustomAmountOnly({ lineItems: [{}] })).toBe(false);
    expect(isCustomAmountOnly({ lineItems: [{ itemType: null }] })).toBe(false);
  });
});
