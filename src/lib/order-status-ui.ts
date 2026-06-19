// Derives the customer-facing order-status card UI (heading / body / stepper)
// from the raw order signals. Kept as a pure, dependency-free function so it can
// be unit-tested in the node test env — OrderStatusHero (a client component)
// just renders whatever this returns.
//
// Pickup and delivery are deliberately driven by DIFFERENT signals:
//
//  • Pickup progress = the Square fulfillment state (PROPOSED → PREPARED →
//    COMPLETED), advanced by staff on the POS.
//  • Delivery progress = the delivery_dispatch lifecycle (pending → accepted →
//    picked_up → delivered). A self-delivery order's fulfillment stays PROPOSED
//    from checkout all the way through driver-accept (we only flip it to
//    PREPARED on pickup), so the fulfillment state alone CANNOT distinguish
//    "waiting for a driver to accept" from "a driver took the job and is on the
//    way to the store". The dispatch status can — so delivery reads that.

export type FulfillmentState =
  | "PROPOSED"
  | "RESERVED"
  | "PREPARED"
  | "COMPLETED"
  | "CANCELED"
  | "FAILED";

export type DispatchStatus = "pending" | "accepted" | "picked_up" | "delivered";

export const PICKUP_STEPS = ["Received", "Preparing", "Ready"] as const;
// Delivery milestones, matching the dispatch lifecycle the customer waits on:
// 0) the order is successfully placed (lit the moment checkout succeeds),
// 1) a driver accepts, 2) they collect the order, 3) it's delivered.
export const DELIVERY_STEPS = [
  "Placed",
  "Accepted",
  "Picked up",
  "Delivered",
] as const;

export type StatusUi = {
  kind: "active" | "completed" | "canceled";
  heading: string;
  body: string;
  tone: "green" | "amber";
  step: number; // index of the highest REACHED step; -1 = none reached yet
  steps: readonly string[];
};

export function deriveStatusUi({
  state,
  isDelivery,
  dispatchStatus = null,
}: {
  state: FulfillmentState | null;
  isDelivery: boolean;
  dispatchStatus?: DispatchStatus | null;
}): StatusUi {
  const steps = isDelivery ? DELIVERY_STEPS : PICKUP_STEPS;

  // Terminal states. Square's COMPLETED is authoritative; we also honour a
  // dispatch 'delivered' in case the dispatch row leads the fulfillment write.
  if (state === "COMPLETED" || dispatchStatus === "delivered") {
    return {
      kind: "completed",
      heading: isDelivery ? "Delivered" : "Picked Up",
      body: "Enjoy your drink! Thanks for visiting Mandy's Bubble Tea.",
      tone: "green",
      step: steps.length,
      steps,
    };
  }

  if (state === "CANCELED" || state === "FAILED") {
    return {
      kind: "canceled",
      heading: "Order Canceled",
      body: "This order was canceled. If you were charged, please speak to a team member at the counter.",
      tone: "amber",
      step: 0,
      steps,
    };
  }

  if (isDelivery) {
    // Fall back to deriving from the fulfillment when the dispatch row is
    // missing/stale: a PREPARED fulfillment means the driver has already picked
    // up (accept never moves the fulfillment, so we can only recover pickup).
    let effective = dispatchStatus;
    if ((!effective || effective === "pending") && state === "PREPARED") {
      effective = "picked_up";
    }

    switch (effective) {
      case "picked_up":
        return {
          kind: "active",
          heading: "Out for Delivery!",
          body: "Your driver has your order and is on the way to your address.",
          tone: "green",
          step: 2,
          steps,
        };
      case "accepted":
        return {
          kind: "active",
          heading: "Driver on the way",
          body: "A driver accepted your order and is heading to the store to collect it.",
          tone: "amber",
          step: 1,
          steps,
        };
      case "pending":
      default:
        // The order is placed (first node lit); we're now matching a driver.
        return {
          kind: "active",
          heading: "Finding your driver",
          body: "We're matching your order with a driver to bring it to your door. Hang tight!",
          tone: "amber",
          step: 0,
          steps,
        };
    }
  }

  // Pickup — driven by the Square fulfillment state.
  if (state === "PREPARED") {
    return {
      kind: "active",
      heading: "Ready for Pickup!",
      body: "Your order is ready at the counter. Come grab it — show your pickup number to our team.",
      tone: "green",
      step: 2,
      steps,
    };
  }

  // PROPOSED / RESERVED / null
  return {
    kind: "active",
    heading: "Preparing your order",
    body: "Our tea masters are crafting your order. We'll have it ready for you at the counter shortly.",
    tone: "amber",
    step: 1,
    steps,
  };
}
