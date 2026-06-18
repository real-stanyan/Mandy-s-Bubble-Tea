import type { Square } from "square";
import { claimOrderPushSlot } from "@/lib/push-tokens";
import { getAllDriverPushTokens } from "@/lib/driver-tokens";
import { sendExpoPush } from "@/lib/push";

/**
 * Push a "new delivery" alert to all registered driver devices when a
 * self-delivery order is placed. Self-delivery orders are PICKUP fulfillments
 * tagged metadata.fulfillment_type=DELIVERY. Idempotent via the
 * order_push_notifications ledger (kind='new_delivery'), so the two triggers
 * (the payment route on authorization + the webhook fallback) and Square's
 * webhook retries never double-notify.
 *
 * IMPORTANT — fires at AUTHORIZATION time (order placed), NOT when the order is
 * paid. Delivery orders are only charged AFTER a driver accepts (which captures
 * the held authorization), so a delivery order's netAmountDue is still > 0 when
 * we need drivers to see it. Keying off "paid" (netAmountDue===0) would mean the
 * order is only advertised after it's already been accepted — a deadlock.
 */
export async function notifyDriversNewDelivery(
  order: Square.Order,
  eventId?: string,
): Promise<void> {
  if (order.metadata?.fulfillment_type !== "DELIVERY") return;
  const orderId = order.id;
  if (!orderId) return;

  const claimed = await claimOrderPushSlot(orderId, "new_delivery");
  if (!claimed) return;

  const tokens = await getAllDriverPushTokens();
  if (tokens.length === 0) return;

  const number = order.referenceId ?? order.ticketName ?? "";
  const address = (order.metadata?.delivery_address as string | undefined) ?? "";
  const accepted = await sendExpoPush(tokens, {
    title: "New delivery 🚚",
    body: [number, address].filter(Boolean).join(" · ") || "New delivery order",
    data: { orderId, kind: "new_delivery" },
  });
  console.log(
    `[driver-push] new delivery ${number} → ${accepted}/${tokens.length} event_id=${eventId ?? "payment"}`,
  );
}
