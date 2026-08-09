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
/**
 * Nag every registered driver device about a delivery that is still sitting
 * unaccepted. Fired by the per-minute sweep for orders older than the grace
 * window, once per tick, until someone accepts or the auto-cancel releases
 * the customer — deliberately NO idempotency ledger, repetition is the
 * feature (Stan, 2026-08-10: a single new-order popup at 10pm was missed and
 * the order silently auto-cancelled half an hour later; see OL-Jorja).
 */
export async function nagDriversUnacceptedDelivery(
  order: Square.Order,
  ageMinutes: number,
  minutesLeft: number,
): Promise<void> {
  if (order.metadata?.fulfillment_type !== "DELIVERY") return;
  if (!order.id) return;

  const tokens = await getAllDriverPushTokens();
  if (tokens.length === 0) return;

  const number = order.referenceId ?? order.ticketName ?? "";
  const address = (order.metadata?.delivery_address as string | undefined) ?? "";
  const accepted = await sendExpoPush(tokens, {
    title: "⏰ Delivery still waiting",
    body:
      [number, address].filter(Boolean).join(" · ") +
      ` — unaccepted ${ageMinutes} min, auto-cancels in ${minutesLeft} min`,
    data: { orderId: order.id, kind: "delivery_nag" },
  });
  console.log(
    `[driver-push] nag ${number} age=${ageMinutes}m left=${minutesLeft}m → ${accepted}/${tokens.length}`,
  );
}

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
