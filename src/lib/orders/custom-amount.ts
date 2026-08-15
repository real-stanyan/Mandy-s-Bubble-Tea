/**
 * Is this Square order nothing but a custom-amount charge?
 *
 * Square's POS lets staff take a payment for an arbitrary amount with no
 * catalog item behind it — the line arrives as item_type CUSTOM_AMOUNT with
 * no name. Two of those turned up in a customer's My Orders on 2026-08-15,
 * A$0.10 and A$1.02, both rung up at the counter during the Mastercard
 * outage while someone checked whether cards were working again.
 *
 * They reached that customer's history without anyone attaching them: the
 * order carries no customer_id, but Square recognised the card as one on
 * their profile and linked it. So the same thing happens any time a card the
 * shop has seen before pays a custom amount — a staff test, or something
 * sold that is not on the menu.
 *
 * Hidden rather than relabelled, because there is nothing to show. The card
 * rendered "1× Item" with a Reorder button that could not reorder anything,
 * under a heading of "#60" — the POS ticket number, which means nothing to
 * the person reading it. A real in-store purchase is unaffected: those carry
 * proper catalog lines and keep showing, which is the point of having the
 * history at all.
 *
 * An order with no lines at all counts as custom-amount-only. It has just as
 * little to say, and leaving it in would put an empty card in the list.
 */
export function isCustomAmountOnly(order: {
  lineItems?: Array<{ itemType?: string | null }> | null;
}): boolean {
  const lines = order.lineItems ?? [];
  if (lines.length === 0) return true;
  return lines.every((li) => li.itemType === "CUSTOM_AMOUNT");
}
