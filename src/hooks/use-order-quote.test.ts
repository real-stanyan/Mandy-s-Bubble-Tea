import { describe, expect, it } from "vitest";
import { interpretQuoteResponse } from "./use-order-quote";

/**
 * The rule this pins: exactly one quote failure is worth interrupting the
 * customer over. Widening that set would blank the summary on every network
 * blip; narrowing it back to nothing is the #90 bug — a cart the server has
 * refused to price, shown with a plausible total and a working Pay button.
 */

const okQuote = {
  ok: true,
  subtotalCents: "5600",
  discounts: [],
  serviceCharges: [],
  discountTotalCents: "0",
  serviceChargeTotalCents: "0",
  rewardCupsSumCents: "0",
  totalCents: "5600",
  netTotalCents: "5600",
  estimated: false,
};

describe("interpretQuoteResponse", () => {
  it("takes a successful quote", () => {
    const out = interpretQuoteResponse(200, okQuote);
    expect(out.kind).toBe("quote");
  });

  it("blocks on the stale-cart 409 and keeps the server's wording", () => {
    const out = interpretQuoteResponse(409, {
      ok: false,
      error: "Some items in your cart are no longer on the menu. Remove them and add them again.",
      unknownVariationIds: ["DELETED_IN_SQUARE"],
    });
    expect(out).toEqual({
      kind: "blocked",
      blocked: {
        reason: "stale-cart",
        message:
          "Some items in your cart are no longer on the menu. Remove them and add them again.",
        variationIds: ["DELETED_IN_SQUARE"],
        soldOut: [],
      },
    });
  });

  it("ignores a signed-out 401 — the plain subtotal is the designed fallback", () => {
    const out = interpretQuoteResponse(401, {
      ok: false,
      error: "Sign in to see your discounts",
    });
    expect(out.kind).toBe("ignore");
  });

  it("ignores a Square outage, so the previous quote stays on screen", () => {
    const out = interpretQuoteResponse(502, { ok: false, error: "boom" });
    expect(out.kind).toBe("ignore");
  });

  it("ignores a 409 that isn't about the cart", () => {
    // The create route also returns 409 for a duplicate submit. Blocking
    // checkout on the status code alone would misfire on that.
    //
    // This case used to use a sold-out body as its example of a 409 to ignore.
    // #101 deliberately reverses that: the quote now refuses a sold-out cart
    // so the customer hears about it before the wallet is tokenized, and the
    // sold-out case has its own test below.
    const out = interpretQuoteResponse(409, {
      ok: false,
      error: "Order already submitted",
    });
    expect(out.kind).toBe("ignore");
  });

  it("survives a body that isn't an object", () => {
    expect(interpretQuoteResponse(500, null).kind).toBe("ignore");
    expect(interpretQuoteResponse(200, undefined).kind).toBe("ignore");
  });

  it("falls back to its own wording if the server sends none", () => {
    const out = interpretQuoteResponse(409, {
      ok: false,
      unknownVariationIds: ["X"],
    });
    expect(out.kind === "blocked" && out.blocked.message).toBeTruthy();
  });
});

// #101: sold-out used to be checked only at create time — after the wallet had
// been tokenized. The quote refuses now, so the page can say so beforehand.
describe("interpretQuoteResponse — a sold-out cart", () => {
  it("blocks on a 409 carrying soldOut names", () => {
    const outcome = interpretQuoteResponse(409, {
      ok: false,
      error: "Pudding just sold out. Remove that drink from your cart and the rest of your order is fine.",
      soldOut: ["Pudding"],
      soldOutLineIndexes: [1],
    });
    expect(outcome).toEqual({
      kind: "blocked",
      blocked: {
        reason: "sold-out",
        message:
          "Pudding just sold out. Remove that drink from your cart and the rest of your order is fine.",
        variationIds: [],
        soldOut: ["Pudding"],
      },
    });
  });

  it("keeps stale-cart and sold-out apart — they need different wording", () => {
    const stale = interpretQuoteResponse(409, {
      ok: false,
      error: "gone",
      unknownVariationIds: ["V1"],
    });
    expect(stale).toMatchObject({ blocked: { reason: "stale-cart" } });
  });

  it("still ignores a 409 that is neither", () => {
    // /api/orders answers 409 for a duplicate submit too.
    expect(
      interpretQuoteResponse(409, { ok: false, error: "Order already submitted" }),
    ).toEqual({ kind: "ignore" });
  });
});
