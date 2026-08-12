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
  const paused = buildStoreDigest({ until: RESUME, reason: "maintenance" });

  it("tells Mandy to stop offering delivery", () => {
    expect(paused).toContain("DELIVERY IS PAUSED RIGHT NOW");
    expect(paused).toContain("maintenance");
  });

  it("REPLACES the delivery facts rather than annotating them", () => {
    // The regression this pins: a warning line sat above "delivery to
    // postcodes 4211, 4214, …" and "Delivery hours: 10:30–22:30", and the
    // model answered "yes, 4217 is in our delivery area" anyway. A live
    // pause must leave no postcode list and no hours to quote.
    expect(paused).not.toContain("4217");
    expect(paused).not.toContain("Delivery hours");
    expect(paused).not.toContain("22:30");
    expect(paused).toContain("pickup at the store ONLY");
  });

  it("keeps the STORE's own hours while delivery is paused", () => {
    // These assertions used to key on the bare string "10:30", which broke
    // the moment the digest learned the shop's opening hours (2026-08-12) —
    // 10:30am is when the door opens, and that stays true whether or not
    // delivery is running. Only the DELIVERY window disappears.
    expect(paused).toContain("Opening hours");
    expect(paused).toContain("10:30am");
  });

  it("says nothing extra when delivery is running", () => {
    for (const digest of [buildStoreDigest(), buildStoreDigest(null)]) {
      expect(digest).not.toContain("PAUSED");
      // …and the real facts are back.
      expect(digest).toContain("4217");
      expect(digest).toContain("Delivery hours");
    }
  });
});
