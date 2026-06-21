import "server-only";
import { squareClient, SQUARE_LOCATION_ID } from "./square";

// Hydrate a set of Square order ids into the few fields the driver History /
// Shift screens need. Completed orders fall out of the active OPEN search, so
// history reads them back by id via orders.batchGet (max 100 ids/call).

export type HydratedOrder = {
  orderNumber: string | null;
  address: string | null;
  customerName: string | null;
  itemSummary: string;
  totalCents: number;
  deliveryFeeCents: number;
};

export async function hydrateOrders(
  orderIds: string[],
): Promise<Record<string, HydratedOrder>> {
  const ids = [...new Set(orderIds.filter(Boolean))];
  const out: Record<string, HydratedOrder> = {};
  if (ids.length === 0) return out;

  // batchGet caps at 100 ids per call — chunk to be safe.
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const res = await squareClient.orders.batchGet({
      orderIds: chunk,
      locationId: SQUARE_LOCATION_ID ?? undefined,
    });
    for (const order of res.orders ?? []) {
      if (!order.id) continue;
      const f = order.fulfillments?.[0];
      out[order.id] = {
        orderNumber: order.referenceId ?? order.ticketName ?? null,
        address: order.metadata?.delivery_address ?? null,
        customerName: f?.pickupDetails?.recipient?.displayName ?? null,
        itemSummary: (order.lineItems ?? [])
          .map((li) => `${li.quantity}× ${li.name ?? "Item"}`)
          .join(", "),
        totalCents: Number(order.totalMoney?.amount ?? 0n),
        deliveryFeeCents: Number(
          order.serviceCharges?.find((sc) => sc.uid === "delivery-fee")
            ?.amountMoney?.amount ?? 0n,
        ),
      };
    }
  }
  return out;
}
