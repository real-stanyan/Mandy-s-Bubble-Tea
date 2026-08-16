import { describe, it, expect } from "vitest";
import { buildStoreDigest } from "./store-digest";

// The two facts that were missing when a customer asked three times how long
// it takes to find a driver and was sent to the phone three times.

describe("what the assistant knows about delivery", () => {
  it("says the shop delivers its own orders", () => {
    // The question had a false premise. Answering "I can't see driver
    // availability" left the customer waiting on something that does not
    // exist.
    const digest = buildStoreDigest(null);
    expect(digest).toMatch(/delivers its own orders/);
    expect(digest).toMatch(/find a driver/);
  });

  it("gives the ten minutes to be accepted", () => {
    expect(buildStoreDigest(null)).toMatch(/within about 10 minutes/);
  });

  it("says none of it while delivery is paused", () => {
    // Paused, the delivery facts are REPLACED rather than annotated — a
    // concrete "we deliver, and here is how long it takes" beats a warning
    // above it every time. Adding facts must not reopen that.
    const paused = buildStoreDigest({ until: "2026-08-17T12:00:00Z", reason: "maintenance" });
    expect(paused).not.toMatch(/delivers its own orders/);
    // Anchored to the delivery acceptance-wait phrase (the same one the
    // positive test above asserts), not bare "10 minutes" — the pickup
    // readiness fact ("ready about 10 minutes later") legitimately stays
    // in the digest while delivery is paused.
    expect(paused).not.toMatch(/within about 10 minutes/);
    expect(paused).toMatch(/DELIVERY IS PAUSED/);
  });
});
