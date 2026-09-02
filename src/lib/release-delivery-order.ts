import "server-only";
import { randomUUID } from "node:crypto";
import { squareClient, SQUARE_LOCATION_ID } from "@/lib/square";
import { returnOrderRewards } from "@/lib/loyalty";
import { pickActiveCardTender } from "@/lib/order-tender";

// Release an unaccepted Mandy Delivery order back to the customer: return any
// redeemed stars, void the held card authorization, and cancel the fulfillment
// so it leaves the active queue. Shared by the 30-minute auto-cancel sweep
// (cron) and an explicit driver "Decline" (status route) — same outcome, one
// implementation.
//
// Order of operations matters: returning rewards (delete) and voiding the hold
// both bump the order version, so the fulfillment cancel re-fetches the order
// for the current version rather than trusting whatever the caller passed in.

type ReleasableOrder = {
  id?: string;
  tenders?: { id?: string; cardDetails?: { status?: string } }[] | null;
  rewards?: { id?: string }[] | null;
};

export async function releaseDeliveryOrder(
  order: ReleasableOrder,
): Promise<{ returned: number; voided: boolean }> {
  if (!order.id) return { returned: 0, voided: false };

  // 1. Return spent stars. The order was never captured, so its rewards are
  //    ISSUED and deletable (returns the points + strips the discount line).
  const { returned } = await returnOrderRewards(order);

  // 2. Release the held card authorization, if there is one ($0 loyalty orders
  //    have no tender). Pick the LIVE tender (an AUTHORIZED retry can sit behind
  //    a FAILED first attempt) so a multi-tender order's hold is actually voided.
  const tender = pickActiveCardTender(order.tenders);
  let voided = false;
  if (tender?.cardDetails?.status === "AUTHORIZED" && tender.id) {
    await squareClient.payments.cancel({ paymentId: tender.id });
    voided = true;
  }

  // 3. Cancel the fulfillment so it drops out of the active queue, AND cancel
  //    the order itself. Square does not cascade fulfillment CANCELED → order
  //    CANCELED: without the state write the order stays OPEN with due > 0 and
  //    a VOIDED tender, which every customer-facing "was this paid?" filter
  //    reads as an abandoned cart — the declined order simply vanished from
  //    Your Orders (DE852, 2026-09-02). Square accepts state=CANCELED here
  //    because nothing was captured (verified on DE852 itself). Re-fetch for
  //    the fresh version — steps 1–2 moved it.
  const fresh = await squareClient.orders.get({ orderId: order.id });
  const fulfillment = fresh.order?.fulfillments?.[0];
  if (fulfillment?.uid && fresh.order?.version != null) {
    await squareClient.orders.update({
      orderId: order.id,
      order: {
        locationId: SQUARE_LOCATION_ID,
        version: fresh.order.version,
        state: "CANCELED",
        fulfillments: [{ uid: fulfillment.uid, state: "CANCELED" }],
      },
      idempotencyKey: randomUUID(),
    });
  }

  return { returned, voided };
}
