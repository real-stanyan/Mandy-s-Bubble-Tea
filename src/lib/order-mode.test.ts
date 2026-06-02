// src/lib/order-mode.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  resolveInitialFulfillment,
  getPreferredFulfillment,
  setPreferredFulfillment,
  wasPopupShown,
  markPopupShown,
} from "./order-mode";

describe("resolveInitialFulfillment", () => {
  const ENOUGH = 1500n; // >= $12 minimum
  const TOO_LOW = 800n; // < $12 minimum

  it("honors DELIVERY when enabled and subtotal meets the minimum", () => {
    expect(resolveInitialFulfillment("DELIVERY", ENOUGH, true)).toBe("DELIVERY");
  });

  it("falls back to PICKUP when DELIVERY preferred but subtotal below minimum", () => {
    expect(resolveInitialFulfillment("DELIVERY", TOO_LOW, true)).toBe("PICKUP");
  });

  it("falls back to PICKUP when DELIVERY preferred but delivery is disabled", () => {
    expect(resolveInitialFulfillment("DELIVERY", ENOUGH, false)).toBe("PICKUP");
  });

  it("returns PICKUP for an explicit PICKUP preference", () => {
    expect(resolveInitialFulfillment("PICKUP", ENOUGH, true)).toBe("PICKUP");
  });

  it("returns PICKUP when there is no stored preference", () => {
    expect(resolveInitialFulfillment(null, ENOUGH, true)).toBe("PICKUP");
  });
});

describe("sessionStorage helpers", () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (k: string) => (k in store ? store[k] : null),
        setItem: (k: string, v: string) => {
          store[k] = v;
        },
        removeItem: (k: string) => {
          delete store[k];
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips the preferred fulfillment", () => {
    expect(getPreferredFulfillment()).toBeNull();
    setPreferredFulfillment("DELIVERY");
    expect(getPreferredFulfillment()).toBe("DELIVERY");
    setPreferredFulfillment("PICKUP");
    expect(getPreferredFulfillment()).toBe("PICKUP");
  });

  it("ignores a corrupt stored preference value", () => {
    store["mandys:orderMode:preferred"] = "GARBAGE";
    expect(getPreferredFulfillment()).toBeNull();
  });

  it("tracks the popup-shown marker", () => {
    expect(wasPopupShown()).toBe(false);
    markPopupShown();
    expect(wasPopupShown()).toBe(true);
  });

  it("no-ops safely when window is undefined (SSR)", () => {
    vi.unstubAllGlobals();
    expect(getPreferredFulfillment()).toBeNull();
    expect(wasPopupShown()).toBe(false);
    expect(() => setPreferredFulfillment("DELIVERY")).not.toThrow();
    expect(() => markPopupShown()).not.toThrow();
  });
});
