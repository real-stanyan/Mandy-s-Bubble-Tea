import { describe, it, expect } from "vitest";
import {
  deriveStatusUi,
  PICKUP_STEPS,
  DELIVERY_STEPS,
} from "./order-status-ui";

describe("deriveStatusUi — pickup (no regression)", () => {
  it("PROPOSED → preparing, step 1, pickup labels", () => {
    const ui = deriveStatusUi({ state: "PROPOSED", isDelivery: false });
    expect(ui.kind).toBe("active");
    expect(ui.heading).toBe("Preparing your order");
    expect(ui.step).toBe(1);
    expect(ui.steps).toEqual(PICKUP_STEPS);
  });

  it("PREPARED → ready for pickup, step 2", () => {
    const ui = deriveStatusUi({ state: "PREPARED", isDelivery: false });
    expect(ui.heading).toBe("Ready for Pickup!");
    expect(ui.tone).toBe("green");
    expect(ui.step).toBe(2);
  });

  it("COMPLETED → picked up (completed card)", () => {
    const ui = deriveStatusUi({ state: "COMPLETED", isDelivery: false });
    expect(ui.kind).toBe("completed");
    expect(ui.heading).toBe("Picked Up");
  });

  it("null state defaults to preparing", () => {
    const ui = deriveStatusUi({ state: null, isDelivery: false });
    expect(ui.heading).toBe("Preparing your order");
    expect(ui.step).toBe(1);
  });
});

describe("deriveStatusUi — delivery, driven by dispatch status", () => {
  it("delivery steps lead with Placed", () => {
    expect(DELIVERY_STEPS[0]).toBe("Placed");
    expect(DELIVERY_STEPS).toEqual([
      "Placed",
      "Accepted",
      "Picked up",
      "Delivered",
    ]);
  });

  it("no dispatch row (PROPOSED, null) → finding a driver, Placed reached", () => {
    const ui = deriveStatusUi({
      state: "PROPOSED",
      isDelivery: true,
      dispatchStatus: null,
    });
    expect(ui.kind).toBe("active");
    expect(ui.heading).toBe("Finding your driver");
    expect(ui.step).toBe(0); // Placed lit; waiting for a driver to accept next
    expect(ui.steps).toEqual(DELIVERY_STEPS);
  });

  it("pending dispatch → still finding a driver, Placed reached", () => {
    const ui = deriveStatusUi({
      state: "PROPOSED",
      isDelivery: true,
      dispatchStatus: "pending",
    });
    expect(ui.heading).toBe("Finding your driver");
    expect(ui.step).toBe(0);
  });

  it("accepted → driver on the way to store, step 1 (Accepted reached)", () => {
    const ui = deriveStatusUi({
      state: "PROPOSED", // fulfillment unchanged on accept — must use dispatch
      isDelivery: true,
      dispatchStatus: "accepted",
    });
    expect(ui.heading).toBe("Driver on the way");
    expect(ui.step).toBe(1);
    expect(ui.tone).toBe("amber");
  });

  it("picked_up → out for delivery, step 2", () => {
    const ui = deriveStatusUi({
      state: "PREPARED",
      isDelivery: true,
      dispatchStatus: "picked_up",
    });
    expect(ui.heading).toBe("Out for Delivery!");
    expect(ui.step).toBe(2);
    expect(ui.tone).toBe("green");
  });

  it("delivered → completed card even if fulfillment lags", () => {
    const ui = deriveStatusUi({
      state: "PREPARED",
      isDelivery: true,
      dispatchStatus: "delivered",
    });
    expect(ui.kind).toBe("completed");
    expect(ui.heading).toBe("Delivered");
    expect(ui.step).toBe(DELIVERY_STEPS.length);
  });

  it("COMPLETED fulfillment → delivered card", () => {
    const ui = deriveStatusUi({
      state: "COMPLETED",
      isDelivery: true,
      dispatchStatus: "picked_up",
    });
    expect(ui.kind).toBe("completed");
    expect(ui.heading).toBe("Delivered");
  });

  it("PREPARED with stale/missing dispatch falls back to picked_up", () => {
    const ui = deriveStatusUi({
      state: "PREPARED",
      isDelivery: true,
      dispatchStatus: null,
    });
    expect(ui.heading).toBe("Out for Delivery!");
    expect(ui.step).toBe(2);
  });

  it("CANCELED (driver declined) → canceled card for delivery", () => {
    const ui = deriveStatusUi({
      state: "CANCELED",
      isDelivery: true,
      dispatchStatus: "pending",
    });
    expect(ui.kind).toBe("canceled");
    expect(ui.heading).toBe("Order Canceled");
    expect(ui.steps).toEqual(DELIVERY_STEPS);
  });
});

describe("held scheduled pickup — Received only, until the ticket prints", () => {
  it("shows step 0 'Order received' while the sticker is held", () => {
    // Stan's spec (2026-08-17): before the print happens, only Received —
    // "Preparing" claimed tea masters were crafting a ticket nobody had.
    const ui = deriveStatusUi({ state: "PROPOSED", isDelivery: false, held: true });
    expect(ui.heading).toBe("Order received");
    expect(ui.step).toBe(0);
    expect(ui.kind).toBe("active");
  });

  it("held never overrides Ready or Completed", () => {
    // A stale held flag racing the fulfillment must lose to reality.
    expect(
      deriveStatusUi({ state: "PREPARED", isDelivery: false, held: true }).heading,
    ).toBe("Ready for Pickup!");
    expect(
      deriveStatusUi({ state: "COMPLETED", isDelivery: false, held: true }).kind,
    ).toBe("completed");
  });

  it("without the flag the ordinary Preparing flow is untouched", () => {
    const ui = deriveStatusUi({ state: "PROPOSED", isDelivery: false });
    expect(ui.heading).toBe("Preparing your order");
    expect(ui.step).toBe(1);
  });
});
