import { describe, it, expect } from "vitest";
import {
  buildOrderMetadata,
  sanitizeAppPlatform,
  sanitizeAppVersion,
  type OrderMetadataInput,
} from "./order-metadata";

const base: OrderMetadataInput = {
  clientPlatform: "web",
  appVersion: null,
  appPlatform: null,
  cartFingerprint: "abc123",
  site: "mandybubbletea.com",
  welcomeDrinksCovered: 0,
  igFollowDrinksCovered: 0,
  tierToppingsCovered: 0,
  delivery: null,
};

describe("sanitizeAppVersion", () => {
  it("accepts the expected version+build shape", () => {
    expect(sanitizeAppVersion("1.1.4+22")).toBe("1.1.4+22");
    expect(sanitizeAppVersion("1.1.3")).toBe("1.1.3");
    expect(sanitizeAppVersion("2.0.0-rc(1)")).toBe("2.0.0-rc(1)");
  });

  it("rejects garbage, oversize, and empty values", () => {
    expect(sanitizeAppVersion(null)).toBeNull();
    expect(sanitizeAppVersion("")).toBeNull();
    expect(sanitizeAppVersion("1.1.4 22")).toBeNull(); // space
    expect(sanitizeAppVersion("<script>")).toBeNull();
    expect(sanitizeAppVersion("1".repeat(33))).toBeNull();
  });
});

describe("sanitizeAppPlatform", () => {
  it("whitelists ios/android only", () => {
    expect(sanitizeAppPlatform("ios")).toBe("ios");
    expect(sanitizeAppPlatform("android")).toBe("android");
    expect(sanitizeAppPlatform("web")).toBeNull();
    expect(sanitizeAppPlatform("IOS")).toBeNull();
    expect(sanitizeAppPlatform(null)).toBeNull();
  });
});

describe("buildOrderMetadata — app_client attribution", () => {
  it("stamps app_client for an app order with a version header", () => {
    const md = buildOrderMetadata({
      ...base,
      clientPlatform: "app",
      appVersion: "1.1.4+22",
      appPlatform: "ios",
    });
    expect(md.app_client).toBe("ios/1.1.4+22");
    expect(md.source).toBe("app");
  });

  it("falls back to '?' when the platform header is missing/invalid", () => {
    const md = buildOrderMetadata({
      ...base,
      clientPlatform: "app",
      appVersion: "1.1.4+22",
      appPlatform: null,
    });
    expect(md.app_client).toBe("?/1.1.4+22");
  });

  it("omits app_client for web orders even if headers were forged", () => {
    const md = buildOrderMetadata({
      ...base,
      clientPlatform: "web",
      appVersion: "9.9.9+99",
      appPlatform: "ios",
    });
    expect("app_client" in md).toBe(false);
  });

  it("omits app_client for app orders without a (valid) version header", () => {
    const md = buildOrderMetadata({
      ...base,
      clientPlatform: "app",
      appVersion: null,
      appPlatform: "ios",
    });
    expect("app_client" in md).toBe(false);
  });
});

describe("buildOrderMetadata — Square 10-entry budget", () => {
  it("worst case (delivery + IG + tier toppings + app_client) stays ≤ 10 entries", () => {
    // Welcome discount is pickup-only server-side, so it can never stack on
    // top of the delivery worst case — this is the true maximum.
    const md = buildOrderMetadata({
      clientPlatform: "app",
      appVersion: "1.1.4+22",
      appPlatform: "ios",
      cartFingerprint: "abc123",
      site: "mandybubbletea.com",
      welcomeDrinksCovered: 0,
      igFollowDrinksCovered: 2,
      tierToppingsCovered: 3,
      delivery: { address: "1 Test St, Southport", lat: -27.96, lng: 153.41 },
    });
    expect(Object.keys(md)).toEqual([
      "source",
      "site",
      "cart_hash",
      "app_client",
      "fulfillment_type",
      "delivery_address",
      "delivery_lat",
      "delivery_lng",
      "igFollowDiscountDrinksCovered",
      "tierToppingsCovered",
    ]);
    expect(Object.keys(md).length).toBeLessThanOrEqual(10);
  });

  it("hypothetical pickup worst case (welcome + IG + tier + app_client) is ≤ 10", () => {
    const md = buildOrderMetadata({
      clientPlatform: "app",
      appVersion: "1.1.4+22",
      appPlatform: "ios",
      cartFingerprint: "abc123",
      site: "mandybubbletea.com",
      welcomeDrinksCovered: 1,
      igFollowDrinksCovered: 2,
      tierToppingsCovered: 3,
      delivery: null,
    });
    expect(Object.keys(md).length).toBeLessThanOrEqual(10);
  });

  it("baseline web pickup order keeps the original three entries", () => {
    const md = buildOrderMetadata(base);
    expect(md).toEqual({
      source: "web",
      site: "mandybubbletea.com",
      cart_hash: "abc123",
    });
  });
});
