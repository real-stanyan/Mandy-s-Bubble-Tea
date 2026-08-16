import "server-only";
import { getAuthedUser } from "@/lib/auth";
import { squareClient, SQUARE_LOCATION_ID } from "@/lib/square";
import { isCustomAmountOnly } from "@/lib/orders/custom-amount";

/**
 * Where the customer's own most recent order has got to.
 *
 * Written because of a real conversation on 16 August: somebody had already
 * ordered, wanted to know whether anyone had picked it up, and was told three
 * times to ring the shop. The assistant had no way to look — it can propose
 * drinks, show a promotion, file a complaint and open checkout, and that is
 * all. The question was answerable; nothing could answer it.
 *
 * Identity comes from the session, never from an argument the model supplies.
 * The model can ask "how is their order going"; it cannot ask about somebody
 * else's, because it has no way to name one.
 */

import { type OrderStatus } from "./order-status-text";

export async function readOrderStatus(request: Request): Promise<OrderStatus> {
  if (!SQUARE_LOCATION_ID) return { known: false, reason: "unavailable" };
  let user: Awaited<ReturnType<typeof getAuthedUser>> = null;
  try {
    user = await getAuthedUser(request);
  } catch {
    return { known: false, reason: "unavailable" };
  }
  const customerId = user?.profile?.square_customer_id;
  if (!customerId) return { known: false, reason: "signed-out" };

  try {
    const res = await squareClient.orders.search({
      locationIds: [SQUARE_LOCATION_ID],
      limit: 5,
      query: {
        filter: {
          customerFilter: { customerIds: [customerId] },
          stateFilter: { states: ["OPEN", "COMPLETED"] },
        },
        sort: { sortField: "CREATED_AT", sortOrder: "DESC" },
      },
    });
    // Custom-amount rows are the counter's own test charges, which get
    // auto-linked to whoever last paid with that card. They are not the
    // customer's order and must never be reported back as one.
    const order = (res.orders ?? []).find((o) => !isCustomAmountOnly(o));
    if (!order) return { known: false, reason: "none" };

    const createdAt = order.createdAt ? Date.parse(order.createdAt) : NaN;
    if (!Number.isFinite(createdAt)) return { known: false, reason: "unavailable" };

    const fulfillment = order.fulfillments?.[0];
    const isDelivery =
      order.metadata?.fulfillment_type === "DELIVERY" || fulfillment?.type === "DELIVERY";

    return {
      known: true,
      reference: order.referenceId ?? order.ticketName ?? "your order",
      placedMinutesAgo: Math.max(0, Math.round((Date.now() - createdAt) / 60000)),
      isDelivery,
      // Self-delivery orders stay OPEN in Square indefinitely, so "open" alone
      // would call a week-old order in progress. The age check upstream is
      // what keeps this honest.
      inProgress: order.state === "OPEN" && fulfillment?.state !== "COMPLETED",
    };
  } catch {
    return { known: false, reason: "unavailable" };
  }
}
