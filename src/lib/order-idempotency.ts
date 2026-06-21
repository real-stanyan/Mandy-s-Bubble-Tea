import { randomUUID, createHash } from "crypto";

/**
 * Stable idempotency key for Square order creation.
 *
 * The checkout client sends a token that stays constant across retries of the
 * same order attempt (per-checkout nonce + a hash of the order body). We
 * namespace it by customer before handing it to Square so:
 *   - a retry of the same order dedupes → Square returns the original order
 *     instead of creating a duplicate (and the payment route's COMPLETED guard
 *     then prevents a second charge);
 *   - two different customers can never collide on the same Square key, and a
 *     guessed token can't surface another customer's order.
 *
 * No token (older app binary) → a fresh random key, i.e. the previous
 * no-dedup behaviour, so old clients keep working.
 */
export function deriveOrderIdempotencyKey(
  customerId: string,
  clientKey?: string | null,
): string {
  if (!clientKey) return randomUUID();
  return createHash("sha256")
    .update(`${customerId}:${clientKey}`)
    .digest("hex");
}
