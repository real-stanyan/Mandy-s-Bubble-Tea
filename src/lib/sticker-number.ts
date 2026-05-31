// src/lib/sticker-number.ts

/**
 * Encode an in-store daily counter value into the compact TA sticker format.
 *
 *   - core: `TA` + (n % 100), zero-padded to 2 digits
 *   - `$` appended for each 1000: floor(n / 1000)
 *   - `*` appended for each 100 within the current thousand: floor((n % 1000) / 100)
 *   - `$`s precede `*`s (larger place first, reads naturally)
 *
 *   47   -> 'TA47'
 *   147  -> 'TA47*'
 *   947  -> 'TA47*********'    (9 stars)
 *   1047 -> 'TA47$'
 *   1247 -> 'TA47$**'
 *   2347 -> 'TA47$$***'
 */
export function encodeStoreStickerNumber(n: number): string {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`encodeStoreStickerNumber: n must be a non-negative integer (got ${n})`);
  }
  const base = String(n % 100).padStart(2, "0");
  const hundreds = Math.floor((n % 1000) / 100);
  const thousands = Math.floor(n / 1000);
  return `TA${base}${"$".repeat(thousands)}${"*".repeat(hundreds)}`;
}

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
