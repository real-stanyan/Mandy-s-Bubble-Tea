import "server-only";
import { squareClient } from "@/lib/square";
import { getUserIdBySquareCustomer } from "@/lib/supabase";
import {
  claimOrderPushSlot,
  getDevicePushTokensForUser,
  type OrderCardPushKind,
} from "@/lib/push-tokens";
import { sendExpoDataPush } from "@/lib/push";

// Android ongoing-card mirror of the iOS Live Activity pushes: at every
// order transition, send the order owner's ANDROID devices a data-only Expo
// push. Nothing is displayed by the OS — the app's background task
// (lib/order-card-background.ts in the app repo) redraws or removes the
// ongoing order-status notification.
//
// Deliberately independent of the LA token gate: Android devices never
// upload an ActivityKit token, so this path does its own cheap gates
// (customer → user → android tokens) and its own ac_* idempotency slots.
//
// Never throws — always fire-and-forget from webhook/driver routes.

export async function sendOrderCardPush(args: {
  orderId: string;
  kind: OrderCardPushKind;
  fulfillment: "pickup" | "delivery";
  status: string;
  driverName?: string | null;
}): Promise<void> {
  try {
    const resp = await squareClient.orders.get({ orderId: args.orderId });
    const order = resp.order;
    const customerId = order?.customerId;
    if (!customerId) return;
    const userId = await getUserIdBySquareCustomer(customerId);
    if (!userId) return;
    const tokens = (await getDevicePushTokensForUser(userId)).filter(
      (t) => t.platform === "android",
    );
    if (tokens.length === 0) return;

    const claimed = await claimOrderPushSlot(args.orderId, args.kind);
    if (!claimed) return; // already sent (webhook redelivery / double source)

    const orderNumber = order?.referenceId ?? order?.ticketName ?? null;
    const accepted = await sendExpoDataPush(
      tokens.map((t) => t.token),
      {
        type: "order-card",
        orderId: args.orderId,
        orderNumber,
        fulfillment: args.fulfillment,
        status: args.status,
        ...(args.driverName ? { driverName: args.driverName } : {}),
      },
    );
    console.log(
      `[order-card] ${args.kind} push order=${args.orderId} → ${accepted}/${tokens.length} android devices`,
    );
  } catch (err) {
    console.error(
      `[order-card] ${args.kind} push failed order=${args.orderId}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

/** Webhook fan-out: map a fulfillment transition to the Android card push.
 *  Runs its own order fetch to type the fulfillment — callers gate nothing. */
export async function sendOrderCardPushForFulfillment(
  orderId: string,
  flags: {
    reserved: boolean;
    prepared: boolean;
    completed: boolean;
    canceled: boolean;
  },
): Promise<void> {
  try {
    const { reserved, prepared, completed, canceled } = flags;
    if (!reserved && !prepared && !completed && !canceled) return;
    const resp = await squareClient.orders.get({ orderId });
    const order = resp.order;
    const fulfillmentType = order?.fulfillments?.[0]?.type;
    const isDelivery =
      order?.metadata?.fulfillment_type === "DELIVERY" ||
      fulfillmentType === "DELIVERY" ||
      fulfillmentType === "SHIPMENT";
    const fulfillment = isDelivery ? "delivery" : "pickup";

    // Precedence mirrors the LA webhook handler: canceled > completed >
    // prepared > reserved.
    if (canceled) {
      await sendOrderCardPush({ orderId, kind: "ac_canceled", fulfillment, status: "canceled" });
    } else if (completed) {
      await sendOrderCardPush(
        isDelivery
          ? { orderId, kind: "ac_delivered", fulfillment, status: "delivered" }
          : { orderId, kind: "ac_completed", fulfillment, status: "completed" },
      );
    } else if (prepared) {
      // Delivery PREPARED usually arrives via the driver route (which also
      // carries the driver's name); this webhook path is the belt-and-braces
      // for POS-driven flips — the shared ac_picked_up slot dedupes.
      await sendOrderCardPush(
        isDelivery
          ? { orderId, kind: "ac_picked_up", fulfillment, status: "picked_up" }
          : { orderId, kind: "ac_ready", fulfillment, status: "ready" },
      );
    } else if (reserved && !isDelivery) {
      await sendOrderCardPush({ orderId, kind: "ac_preparing", fulfillment, status: "preparing" });
    }
  } catch (err) {
    console.error(
      `[order-card] fulfillment fan-out failed order=${orderId}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}
