import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { quoteDelivery, createDelivery, verifyWebhookSignature } from "../uber-direct";

describe("uber-direct (mock mode)", () => {
  beforeEach(() => {
    process.env.UBER_DIRECT_MODE = "mock";
    process.env.UBER_DIRECT_WEBHOOK_SECRET = "test-secret";
  });

  afterEach(() => {
    delete process.env.UBER_DIRECT_MODE;
    delete process.env.UBER_DIRECT_WEBHOOK_SECRET;
  });

  describe("quoteDelivery", () => {
    it("returns ok with etaMin and quoteId for valid in-zone request", async () => {
      const result = await quoteDelivery({
        dropoffAddress: "12 Smith St, Surfers Paradise QLD 4217",
        dropoffLat: -28.0023,
        dropoffLng: 153.4145,
        dropoffPhone: "+61404978238",
        dropoffName: "Test Customer",
        orderValueCents: 2500,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.etaMin).toBeGreaterThan(0);
        expect(result.quoteId).toMatch(/^mock_quote_/);
        expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
      }
    });

    it("returns reason='out_of_zone' when address marker contains '__OOZ__'", async () => {
      const result = await quoteDelivery({
        dropoffAddress: "__OOZ__ test",
        dropoffLat: -27.5,
        dropoffLng: 153.0,
        dropoffPhone: "+61404978238",
        dropoffName: "Test",
        orderValueCents: 2500,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("out_of_zone");
    });

    it("returns reason='no_driver' when address marker contains '__NODRIVER__'", async () => {
      const result = await quoteDelivery({
        dropoffAddress: "__NODRIVER__ test",
        dropoffLat: -28.0,
        dropoffLng: 153.4,
        dropoffPhone: "+61404978238",
        dropoffName: "Test",
        orderValueCents: 2500,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("no_driver");
    });
  });

  describe("createDelivery", () => {
    it("returns deliveryId + trackingUrl for a valid quote", async () => {
      const result = await createDelivery({
        quoteId: "mock_quote_xyz",
        externalOrderId: "OL801",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.deliveryId).toMatch(/^mock_delivery_/);
        expect(result.trackingUrl).toMatch(/^https:\/\//);
      }
    });

    it("returns ok:false when quoteId contains '__FAIL__'", async () => {
      const result = await createDelivery({
        quoteId: "mock_quote___FAIL__",
        externalOrderId: "OL802",
      });
      expect(result.ok).toBe(false);
    });
  });

  describe("verifyWebhookSignature", () => {
    it("returns true for matching HMAC-SHA256", () => {
      const body = '{"event":"delivered"}';
      // HMAC-SHA256("test-secret", body) hex
      const sig = "f6e25c7e08bdba76dadcc1ce03a55b8d6f3dc0a4f87f2e58fe1ad2b7c8e6f8d3";
      // The exact signature value is computed inside the test — replace by real expected
      // by importing crypto and computing here, instead of hardcoding:
      const crypto = require("crypto");
      const expected = crypto.createHmac("sha256", "test-secret").update(body).digest("hex");
      expect(verifyWebhookSignature(body, expected)).toBe(true);
    });

    it("returns false for tampered signature", () => {
      const body = '{"event":"delivered"}';
      expect(verifyWebhookSignature(body, "deadbeef")).toBe(false);
    });
  });
});
