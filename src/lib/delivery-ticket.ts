// Self-delivery ticket helpers.
//
// Square deliberately hides API-created DELIVERY-type fulfillment orders from
// the seller's POS / Order Manager unless you hold a formal Square delivery
// partnership (see docs/superpowers/specs/2026-06-01-square-self-delivery-design.md).
// PICKUP-type orders are not walled. So a self-delivery order is created as a
// PICKUP fulfillment and the delivery address + phone are stamped into the
// fulfillment note + ticket name — the fields Square Register actually displays
// to staff (metadata is API-only and never shown in the POS UI).

const SEP = " · ";

/**
 * The note stamped onto a self-delivery order's PICKUP fulfillment. Leads with
 * a 🚚 marker + the address so staff instantly see this ticket must be driven
 * out (not handed over a counter), and where to.
 */
export function deliveryFulfillmentNote(args: {
  address: string;
  phone: string;
  driverNote?: string;
  orderNote?: string;
}): string {
  return [
    `🚚 DELIVERY${SEP}${args.address}`,
    args.phone,
    args.driverNote,
    args.orderNote,
  ]
    .filter(Boolean)
    .join(SEP);
}

/**
 * Ticket name shown in the Square Register order list. The 🚚 prefix lets staff
 * distinguish delivery tickets from pickup tickets at a glance.
 */
export function deliveryTicketName(orderNumber: string): string {
  return `🚚 ${orderNumber}`;
}
