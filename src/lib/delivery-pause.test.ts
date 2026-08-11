import { describe, it, expect } from "vitest";
import { deliveryMaintenanceCopy } from "@/components/checkout/FulfillmentSelector";
import { buildStoreDigest } from "@/lib/chat/store-digest";

/** 17:00 Brisbane on 2026-08-11 — the window Stan asked for. */
const RESUME = "2026-08-11T07:00:00.000Z";

describe("deliveryMaintenanceCopy", () => {
  it("names the reason and the Brisbane return time", () => {
    const copy = deliveryMaintenanceCopy(RESUME);
    expect(copy).toContain("system maintenance");
    expect(copy).toContain("5:00pm");
    // Pickup staying open is the part that saves the sale.
    expect(copy).toContain("Pickup is still open");
  });

  it("renders morning times without a 0 hour", () => {
    // 00:00 UTC = 10:00 Brisbane.
    expect(deliveryMaintenanceCopy("2026-08-11T00:00:00.000Z")).toContain("10:00am");
    // 14:00 UTC = midnight Brisbane — 12, never 0.
    expect(deliveryMaintenanceCopy("2026-08-11T14:00:00.000Z")).toContain("12:00am");
  });

  it("still says something useful when the timestamp is junk", () => {
    const copy = deliveryMaintenanceCopy("not-a-date");
    expect(copy).toContain("system maintenance");
    expect(copy).not.toContain("NaN");
  });
});

describe("buildStoreDigest with a pause", () => {
  it("tells Mandy to stop offering delivery", () => {
    const digest = buildStoreDigest({ until: RESUME, reason: "maintenance" });
    expect(digest).toContain("DELIVERY IS PAUSED RIGHT NOW");
    expect(digest).toContain("maintenance");
  });

  it("says nothing extra when delivery is running", () => {
    expect(buildStoreDigest()).not.toContain("PAUSED");
    expect(buildStoreDigest(null)).not.toContain("PAUSED");
  });
});
