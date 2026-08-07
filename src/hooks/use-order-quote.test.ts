import { describe, expect, it } from "vitest";
import { interpretQuoteResponse, isQuoteStale } from "./use-order-quote";

/**
 * The rule this pins: exactly two quote failures are worth interrupting the
 * customer over — a stale cart (#90) and a sold-out item/modifier. Widening
 * that set would blank the summary on every network blip; narrowing it back
 * to nothing shows a plausible total and a working Pay button for a cart the
 * create route is guaranteed to refuse.
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
        items: ["DELETED_IN_SQUARE"],
      },
    });
  });

  it("blocks on the sold-out 409 and keeps the server's wording", () => {
    // A sold-out topping/variation used to fall through to "ignore" here,
    // which left checkout showing a believable total and a working Pay
    // button right up until /api/orders rejected the order at the last step
    // with a "Payment Failed" dialog that had nothing to do with payment.
    const out = interpretQuoteResponse(409, {
      ok: false,
      error: "Sold out: Pearls. Please refresh the menu.",
      soldOut: ["Pearls"],
    });
    expect(out).toEqual({
      kind: "blocked",
      blocked: {
        reason: "sold-out",
        message: "Sold out: Pearls. Please refresh the menu.",
        items: ["Pearls"],
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

  it("ignores a 409 that isn't about the cart (e.g. duplicate submit)", () => {
    // Not every 409 is worth interrupting checkout for — only the two shapes
    // the quote route actually returns (unknownVariationIds / soldOut).
    // Blocking on the status code alone would misfire on unrelated gates.
    const out = interpretQuoteResponse(409, {
      ok: false,
      error: "Duplicate order",
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

/**
 * The rule this pins: checkout may only act on a quote that was priced for the
 * cart currently on screen.
 *
 * Why it exists (2026-08-07): applying a star reward and tapping Pay inside the
 * 250ms debounce window opened an Apple Pay sheet for a pickup order the server
 * then priced at $0. The page decides whether any money is due from the quote,
 * and stale-while-revalidate had left the pre-reward quote on hand. `loading`
 * could not have caught it — it is still false throughout the debounce.
 */
describe("isQuoteStale", () => {
  it("is not stale when there is nothing to price", () => {
    // Empty/disabled cart. No request is coming, so nothing is being waited on.
    expect(isQuoteStale(null, null)).toBe(false);
    expect(isQuoteStale(null, "some|older|cart")).toBe(false);
  });

  it("is stale before the first answer lands", () => {
    expect(isQuoteStale("cart-a", null)).toBe(true);
  });

  it("is not stale once this cart has been answered", () => {
    expect(isQuoteStale("cart-a", "cart-a")).toBe(false);
  });

  it("is stale while the previous cart's quote is the one on hand", () => {
    // The reward-then-Pay race: reward count is part of the key, so the moment
    // it changes the quote on screen is answering the wrong question.
    expect(isQuoteStale("cart-a|reward-1", "cart-a|reward-0")).toBe(true);
  });

  it("clears once the request settles, even if the answer was swallowed", () => {
    // A 401/502 is intentionally ignored (the old quote stays, the page falls
    // back to the bare subtotal) — but the hook still records the key as
    // settled, or a signed-out customer would face a permanently dead Pay
    // button. That write lives in the effect's .catch/.then; this pins the
    // decision it feeds.
    expect(isQuoteStale("cart-a", "cart-a")).toBe(false);
  });
});
