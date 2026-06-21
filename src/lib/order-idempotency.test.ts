import { describe, it, expect } from "vitest";
import { deriveOrderIdempotencyKey } from "./order-idempotency";

describe("deriveOrderIdempotencyKey", () => {
  it("is stable for the same customer + client token (a retry dedupes)", () => {
    const a = deriveOrderIdempotencyKey("cust_1", "tok-abc");
    const b = deriveOrderIdempotencyKey("cust_1", "tok-abc");
    expect(a).toBe(b);
  });

  it("changes when the client token changes (new cart → new order)", () => {
    expect(deriveOrderIdempotencyKey("cust_1", "tok-abc")).not.toBe(
      deriveOrderIdempotencyKey("cust_1", "tok-def"),
    );
  });

  it("namespaces by customer (no cross-customer collision / leak)", () => {
    expect(deriveOrderIdempotencyKey("cust_1", "tok-abc")).not.toBe(
      deriveOrderIdempotencyKey("cust_2", "tok-abc"),
    );
  });

  it("falls back to a fresh random key when no token (old binary, no dedup)", () => {
    const a = deriveOrderIdempotencyKey("cust_1");
    const b = deriveOrderIdempotencyKey("cust_1");
    expect(a).not.toBe(b);
    expect(a).toHaveLength(36); // uuid v4
  });

  it("produces a Square-safe key length (<= 192 chars)", () => {
    const k = deriveOrderIdempotencyKey("cust_1", "x".repeat(500));
    expect(k.length).toBeLessThanOrEqual(192);
    expect(k).toHaveLength(64); // sha256 hex
  });
});
