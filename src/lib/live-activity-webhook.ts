import "server-only";
import { squareClient } from "./square";
import {
  getLiveActivityToken,
  sendLiveActivityStatusPush,
} from "./live-activity";

// Live Activity fan-out for Square order.fulfillment.updated webhook events.
// Lives here (not in the webhook route file) so the transition mapping —
// the densest decision branch of the LA feature — is unit-testable; Next
// route files may only export route handlers.

/** Minimal structural slice of a Square order.fulfillment.updated event —
 * the webhook route's richer SquareEvent type satisfies it. */
export type FulfillmentUpdatedEvent = {
  data?: {
    object?: {
      order_fulfillment_updated?: {
        order_id?: string;
        fulfillment_update?: { new_state?: string }[];
      };
    };
  };
};

/**
 * All fulfillment new_state values on an order.fulfillment.updated event —
 * the fan-out cares about RESERVED / PREPARED / COMPLETED / CANCELED /
 * FAILED (the webhook's pickReadyOrderId stays PREPARED-only for the
 * legacy Expo "ready" push). Returns null when the event carries none.
 */
export function pickFulfillmentTransition(
  event: FulfillmentUpdatedEvent,
): { orderId: string; newStates: string[] } | null {
  const payload = event.data?.object?.order_fulfillment_updated;
  if (!payload?.order_id) return null;
  const newStates = (payload.fulfillment_update ?? [])
    .map((u) => u.new_state)
    .filter((s): s is string => typeof s === "string");
  if (newStates.length === 0) return null;
  return { orderId: payload.order_id, newStates };
}

/**
 * Live Activity fan-out for fulfillment transitions. Ownership split with
 * the driver routes (see src/app/api/driver/*):
 *
 *   - pickup RESERVED            → la_preparing "preparing"  (update) —
 *     three-state pickup card (Received → Preparing → Ready, contract
 *     revision 2026-07-06 after Stan's on-device acceptance). "received"
 *     is app-local initial state; the server never sends it.
 *   - pickup PREPARED            → la_ready   "ready"      (update)
 *   - pickup COMPLETED           → la_completed "completed" (end)
 *   - delivery RESERVED          → SKIPPED — meaningless for the delivery
 *     card vocabulary.
 *   - delivery PREPARED          → SKIPPED — driver pickup causes it; the
 *     driver status route sends la_picked_up (with driverName, which the
 *     webhook doesn't have).
 *   - delivery COMPLETED         → la_delivered "delivered" (end) — shares
 *     the idempotency slot with the driver route, so whichever lands first
 *     wins and the other is a silent no-op (covers staff completing a
 *     delivery order directly in the POS).
 *   - CANCELED / FAILED (both)   → la_canceled "canceled"   (end)
 *
 * Precedence when one event carries several transitions:
 * canceled > completed > prepared > reserved.
 *
 * Never throws — runs fire-and-forget from the webhook via after().
 */
export async function handleLiveActivityFulfillment(
  orderId: string,
  newStates: string[],
  eventId?: string,
): Promise<void> {
  try {
    const reserved = newStates.includes("RESERVED");
    const prepared = newStates.includes("PREPARED");
    const completed = newStates.includes("COMPLETED");
    const canceled = newStates.includes("CANCELED") || newStates.includes("FAILED");
    if (!reserved && !prepared && !completed && !canceled) return;

    // Cheap gate before touching Square: most orders have no Live Activity.
    const token = await getLiveActivityToken(orderId);
    if (!token) return;

    // Fulfillment type picks the content-state vocabulary (pickup vs delivery).
    const resp = await squareClient.orders.get({ orderId });
    const order = resp.order;
    const fulfillmentType = order?.fulfillments?.[0]?.type;
    const isDelivery =
      order?.metadata?.fulfillment_type === "DELIVERY" ||
      fulfillmentType === "DELIVERY" ||
      fulfillmentType === "SHIPMENT";

    if (canceled) {
      await sendLiveActivityStatusPush({
        orderId,
        kind: "la_canceled",
        status: "canceled",
        event: "end",
      });
    } else if (completed) {
      await sendLiveActivityStatusPush(
        isDelivery
          ? { orderId, kind: "la_delivered", status: "delivered", event: "end" }
          : { orderId, kind: "la_completed", status: "completed", event: "end" },
      );
    } else if (prepared && !isDelivery) {
      await sendLiveActivityStatusPush({
        orderId,
        kind: "la_ready",
        status: "ready",
        event: "update",
      });
    } else if (reserved && !isDelivery) {
      // Staff started making the order — flip the pickup card to Preparing.
      await sendLiveActivityStatusPush({
        orderId,
        kind: "la_preparing",
        status: "preparing",
        event: "update",
      });
    }
  } catch (err) {
    console.error(
      `[live-activity] webhook fulfillment fan-out failed order=${orderId} event_id=${eventId}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}
