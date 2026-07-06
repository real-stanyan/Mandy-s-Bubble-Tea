import { describe, it, expect } from "vitest";
import { isPaymentAccepted } from "./payment-response";

// Client-side gate for the /api/payment response (OL807 defense-in-depth):
// checkout must only navigate to the confirmation page when the payment
// actually settled — never on a bare ok:true whose status says otherwise.
// Success shapes from the route:
//   - status COMPLETED (captured card)
//   - status APPROVED (delivery authorize-only hold)
//   - alreadyPaid:true (idempotent replay of a live-tender order)
//   - status null with ok:true ($0 loyalty-redeem — closed via orders.pay)

describe("isPaymentAccepted", () => {
  it("accepts captured card payment", () => {
    expect(isPaymentAccepted({ ok: true, status: "COMPLETED" })).toBe(true);
  });
  it("accepts delivery authorize-only hold", () => {
    expect(isPaymentAccepted({ ok: true, status: "APPROVED" })).toBe(true);
  });
  it("accepts idempotent alreadyPaid replay", () => {
    expect(isPaymentAccepted({ ok: true, status: "COMPLETED", alreadyPaid: true })).toBe(true);
  });
  it("accepts $0 redeem (ok:true, status null)", () => {
    expect(isPaymentAccepted({ ok: true, status: null })).toBe(true);
    expect(isPaymentAccepted({ ok: true })).toBe(true);
  });
  it("rejects ok:false", () => {
    expect(isPaymentAccepted({ ok: false, status: "FAILED" })).toBe(false);
    expect(isPaymentAccepted({ ok: false })).toBe(false);
  });
  it("rejects ok:true with FAILED status (the OL807 shape)", () => {
    expect(isPaymentAccepted({ ok: true, status: "FAILED" })).toBe(false);
  });
  it("rejects ok:true with CANCELED status", () => {
    expect(isPaymentAccepted({ ok: true, status: "CANCELED" })).toBe(false);
  });
  it("accepts PENDING (mirrors the server: may still settle — treating it as declined would invite a duplicate order)", () => {
    expect(isPaymentAccepted({ ok: true, status: "PENDING" })).toBe(true);
  });
  it("rejects garbage", () => {
    expect(isPaymentAccepted(null)).toBe(false);
    expect(isPaymentAccepted(undefined)).toBe(false);
    expect(isPaymentAccepted("ok")).toBe(false);
  });
});
