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

/**
 * True when a Square `order.ticketName` is a real order / ticket NUMBER we
 * can print in the cup-sticker number slot — as opposed to a customer's
 * NAME. When a member is left attached to a POS order Square names the
 * ticket after them, which is either a phone number (handled by
 * `looksLikePhoneNumber`) OR the customer's name (e.g. "Mao Sasaki").
 * Neither belongs in the number slot: the name must go in the
 * "Hi, {name}" greeting and the number falls back to the store counter.
 *
 * Discriminator: a real order number always carries a digit — POS register
 * numbers ("8" / "44"), our own web ("OL846") and TA counter ("TA47") all
 * do; a person's name ("Mao Sasaki" / "John") does not. Phone-like names
 * carry digits but are rejected first so they never print.
 */
export function isUsableOrderTicketName(ticketName: string): boolean {
  const trimmed = ticketName.trim();
  if (trimmed.length === 0) return false;
  if (looksLikePhoneNumber(trimmed)) return false;
  return /\d/.test(trimmed);
}
