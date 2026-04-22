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
