// Tender liveness classification — shared by the /api/payment alreadyPaid
// guard and the order-confirmation page.
//
// Background (OL807, 2026-07-06): when a card charge is DECLINED
// (e.g. INSUFFICIENT_FUNDS), Square still attaches a tender to the order
// with cardDetails.status = "FAILED". A naive "tender exists ⇒ already
// paid" check then misreads the dead tender as money in the till: a
// customer retrying their declined card got a fake alreadyPaid success,
// was navigated to the confirmation page, and showed staff a "Preparing
// your order" screen for an order that was never paid.
//
// Card tender statuses (Square Orders API):
//   AUTHORIZED — hold placed, not captured (our delivery pre-auth) → live
//   CAPTURED   — money collected → live
//   FAILED     — charge declined → dead
//   VOIDED     — hold released without capture → dead
//
// Tenders with no cardDetails (non-card types, older API shapes) count as
// live: treating an unknown tender as paid can at worst re-show the
// alreadyPaid response, while treating it as dead could re-charge a card
// (the Thomas double-authorization bug this guard exists to prevent).

type TenderLike = {
  id?: string | null;
  type?: string | null;
  cardDetails?: { status?: string | null } | null;
};

type OrderLike = {
  state?: string | null;
  tenders?: TenderLike[] | null;
};

const DEAD_CARD_STATUSES = new Set(["FAILED", "VOIDED"]);

/** A tender whose card charge failed or was voided — no money moved/held. */
export function isDeadTender(tender: TenderLike): boolean {
  const status = tender.cardDetails?.status;
  return typeof status === "string" && DEAD_CARD_STATUSES.has(status);
}

/** True when the order has at least one tender that actually holds money. */
export function hasLiveTender(order: OrderLike): boolean {
  return (order.tenders ?? []).some((t) => !isDeadTender(t));
}

/**
 * A ghost order: still OPEN, at least one payment was attempted, and every
 * attempt failed. The customer owes nothing and no drink should be made —
 * the confirmation page must show a payment-failed state, not "Preparing".
 */
export function isPaymentFailedOrder(order: OrderLike): boolean {
  const tenders = order.tenders ?? [];
  return order.state === "OPEN" && tenders.length > 0 && tenders.every(isDeadTender);
}
