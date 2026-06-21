import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getOrCreateOrderNonce, clearOrderNonce } from "./checkout-nonce";

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

describe("checkout-nonce — persisted across reload", () => {
  beforeEach(() => {
    (globalThis as { window?: unknown }).window = { localStorage: fakeStorage() };
    clearOrderNonce();
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("returns the same nonce on repeat calls (one checkout intent)", () => {
    const a = getOrCreateOrderNonce();
    const b = getOrCreateOrderNonce();
    expect(a).toBe(b);
    expect(a).toMatch(/[0-9a-f-]{36}/);
  });

  it("reuses a nonce already in storage (survives a reload)", () => {
    const ls = (globalThis as { window: { localStorage: Storage } }).window.localStorage;
    ls.setItem("mbt_order_nonce_v1", "pre-existing-nonce");
    expect(getOrCreateOrderNonce()).toBe("pre-existing-nonce");
  });

  it("generates a fresh nonce after clear (deliberate new order)", () => {
    const first = getOrCreateOrderNonce();
    clearOrderNonce();
    const second = getOrCreateOrderNonce();
    expect(second).not.toBe(first);
  });
});

describe("checkout-nonce — memory fallback when storage unavailable", () => {
  beforeEach(() => {
    delete (globalThis as { window?: unknown }).window;
    clearOrderNonce();
  });

  it("still returns a stable nonce and clears", () => {
    const a = getOrCreateOrderNonce();
    expect(getOrCreateOrderNonce()).toBe(a);
    clearOrderNonce();
    expect(getOrCreateOrderNonce()).not.toBe(a);
  });

  it("does not throw when localStorage access throws", () => {
    (globalThis as { window?: unknown }).window = {
      get localStorage(): Storage {
        throw new Error("blocked (private mode)");
      },
    };
    expect(() => getOrCreateOrderNonce()).not.toThrow();
    expect(typeof getOrCreateOrderNonce()).toBe("string");
  });
});
