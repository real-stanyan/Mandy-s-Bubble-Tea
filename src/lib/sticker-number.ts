// src/lib/sticker-number.ts

/**
 * True when a Square `order.ticketName` is actually a customer phone
 * number rather than a real ticket/order number. Square POS Register
 * names the ticket after the attached customer's phone when a member is
 * left attached to the order ("auto-logged-in member"), and we must NOT
 * print that on a public cup sticker — both because staff can't match it
 * to an order and because it leaks the customer's phone number. Callers
 * fall back to the in-store TA counter instead.
 *
 * Detects 8+ digits with an optional leading `+` after stripping spaces
 * and dashes. Real Register ticket numbers reset daily and stay short
 * (1–3 digits); our own numbers carry letters ("OL846" / "TA47"), so none
 * of those match.
 */
export function looksLikePhoneNumber(ticketName: string): boolean {
  const compact = ticketName.replace(/[\s-]/g, "");
  return /^\+?\d{8,}$/.test(compact);
}
