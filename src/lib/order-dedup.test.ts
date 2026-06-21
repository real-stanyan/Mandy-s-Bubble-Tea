import { describe, it, expect } from "vitest";
import { cartHash, pickDuplicateOrder } from "./order-dedup";

describe("cartHash", () => {
  const a = {
    itemName: "Lychee Iced Green Tea",
    variationId: "V1",
    quantity: 1,
    modifiers: [{ id: "m1" }, { id: "m2" }],
  };

  it("is stable for the same cart regardless of modifier / line order", () => {
    const h1 = cartHash([a]);
    const h2 = cartHash([
      { ...a, modifiers: [{ id: "m2" }, { id: "m1" }] },
    ]);
    expect(h1).toBe(h2);
  });

  it("differs when the drink, variation, quantity or modifiers differ", () => {
    const base = cartHash([a]);
    expect(cartHash([{ ...a, variationId: "V2" }])).not.toBe(base);
    expect(cartHash([{ ...a, quantity: 2 }])).not.toBe(base);
    expect(cartHash([{ ...a, modifiers: [{ id: "m1" }] }])).not.toBe(base);
    expect(cartHash([{ ...a, itemName: "Taro" }])).not.toBe(base);
  });

  it("order of lines in the cart does not change the hash", () => {
    const b = { ...a, variationId: "V2" };
    expect(cartHash([a, b])).toBe(cartHash([b, a]));
  });
});

describe("pickDuplicateOrder", () => {
  const now = Date.parse("2026-06-21T03:25:00.000Z");
  const HASH = "abc";
  const within = 5 * 60 * 1000;

  const mk = (over: Record<string, unknown>) => ({
    id: "O1",
    state: "COMPLETED",
    createdAt: "2026-06-21T03:23:18.000Z", // ~104s ago
    metadata: { cart_hash: HASH },
    ...over,
  });

  it("returns a recent same-hash OPEN/COMPLETED order", () => {
    expect(pickDuplicateOrder([mk({})], HASH, within, now)?.id).toBe("O1");
    expect(pickDuplicateOrder([mk({ state: "OPEN" })], HASH, within, now)?.id).toBe("O1");
  });

  it("ignores orders with a different cart hash", () => {
    expect(
      pickDuplicateOrder([mk({ metadata: { cart_hash: "other" } })], HASH, within, now),
    ).toBeNull();
  });

  it("ignores canceled / draft orders", () => {
    expect(pickDuplicateOrder([mk({ state: "CANCELED" })], HASH, within, now)).toBeNull();
    expect(pickDuplicateOrder([mk({ state: "DRAFT" })], HASH, within, now)).toBeNull();
  });

  it("ignores orders outside the time window", () => {
    expect(
      pickDuplicateOrder(
        [mk({ createdAt: "2026-06-21T03:15:00.000Z" })], // 10 min ago
        HASH,
        within,
        now,
      ),
    ).toBeNull();
  });

  it("returns the first match and tolerates missing fields", () => {
    expect(pickDuplicateOrder([{}, mk({})], HASH, within, now)?.id).toBe("O1");
    expect(pickDuplicateOrder([], HASH, within, now)).toBeNull();
  });
});
