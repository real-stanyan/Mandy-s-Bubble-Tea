import { describe, it, expect } from "vitest";
import { isDeadTender, hasLiveTender, isPaymentFailedOrder } from "./tender-state";

// OL807 (2026-07-06): Square attaches a tender to the order even when the
// card charge FAILS (INSUFFICIENT_FUNDS). A "tender exists ⇒ already paid"
// check misreads that dead tender as money in the till. These helpers
// classify tenders by their cardDetails.status so failed/voided charges
// never count as payment.

const failed = { id: "t1", type: "CARD", cardDetails: { status: "FAILED" } };
const voided = { id: "t2", type: "CARD", cardDetails: { status: "VOIDED" } };
const captured = { id: "t3", type: "CARD", cardDetails: { status: "CAPTURED" } };
const authorized = { id: "t4", type: "CARD", cardDetails: { status: "AUTHORIZED" } }; // delivery hold
const bare = { id: "t5", type: "CARD" }; // older shape / non-card tender — no cardDetails

describe("isDeadTender", () => {
  it("FAILED card tender is dead", () => {
    expect(isDeadTender(failed)).toBe(true);
  });
  it("VOIDED card tender is dead", () => {
    expect(isDeadTender(voided)).toBe(true);
  });
  it("CAPTURED card tender is live", () => {
    expect(isDeadTender(captured)).toBe(false);
  });
  it("AUTHORIZED card tender (delivery pre-auth hold) is live", () => {
    expect(isDeadTender(authorized)).toBe(false);
  });
  it("tender without cardDetails is live (conservative — keeps the Thomas double-charge guard)", () => {
    expect(isDeadTender(bare)).toBe(false);
  });
});

describe("hasLiveTender", () => {
  it("false when the only tender FAILED (OL807 case)", () => {
    expect(hasLiveTender({ tenders: [failed] })).toBe(false);
  });
  it("true when any tender is live", () => {
    expect(hasLiveTender({ tenders: [failed, captured] })).toBe(true);
  });
  it("false with no tenders / undefined tenders", () => {
    expect(hasLiveTender({ tenders: [] })).toBe(false);
    expect(hasLiveTender({})).toBe(false);
  });
});

describe("isPaymentFailedOrder", () => {
  it("OPEN order whose every tender failed → payment-failed (ghost order)", () => {
    expect(isPaymentFailedOrder({ state: "OPEN", tenders: [failed] })).toBe(true);
  });
  it("OPEN order with a live tender → not failed", () => {
    expect(isPaymentFailedOrder({ state: "OPEN", tenders: [failed, authorized] })).toBe(false);
  });
  it("OPEN order with no tenders (pre-payment) → not failed", () => {
    expect(isPaymentFailedOrder({ state: "OPEN", tenders: [] })).toBe(false);
  });
  it("COMPLETED order → never failed", () => {
    expect(isPaymentFailedOrder({ state: "COMPLETED", tenders: [failed] })).toBe(false);
  });
});
