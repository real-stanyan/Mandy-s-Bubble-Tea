// Mandy Delivery authorizes the card at checkout and captures only when a
// driver accepts (payment route: autocomplete = !isDelivery), so a paid-for
// but not-yet-accepted delivery order has netAmountDue > 0 with an AUTHORIZED
// card tender. Anywhere that treats "due === 0" as "was this paid?" must also
// accept that hold, or the order vanishes for exactly the window the customer
// is most anxious about — charged, no driver yet. The driver queue has always
// known this (driver/orders route); the customer-facing lists learned it on
// 2026-08-23, after a real customer was charged and told "no active orders".
export function hasAuthorizedHold(order: {
  tenders?:
    | Array<{ cardDetails?: { status?: string | null } | null }>
    | null;
}): boolean {
  return (
    order.tenders?.some((t) => t.cardDetails?.status === "AUTHORIZED") ?? false
  );
}
