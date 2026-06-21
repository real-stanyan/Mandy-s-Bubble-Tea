import { createHash } from "crypto";

// Server-side duplicate-order backstop. The client persists an idempotency nonce
// (see checkout-nonce.ts) so a reload reuses the same Square key, but that can't
// help when the same customer re-submits the same cart from a DIFFERENT device /
// browser (different client state → different key). To still avoid a 2nd order +
// charge, we stamp each order with a hash of its cart and, before creating a new
// one, look for a recent order from the same customer carrying the same hash.

type CartLineLike = {
  itemName?: string;
  variationId?: string;
  quantity?: number;
  modifiers?: { id?: string }[];
};

/** Stable fingerprint of a cart — independent of line / modifier ordering. */
export function cartHash(lines: CartLineLike[]): string {
  const norm = lines.map((l) => ({
    i: l.itemName ?? "",
    v: l.variationId ?? "",
    q: l.quantity ?? 1,
    m: (l.modifiers ?? []).map((x) => x.id ?? "").sort(),
  }));
  norm.sort((a, b) =>
    (a.v + a.i).localeCompare(b.v + b.i) ||
    JSON.stringify(a.m).localeCompare(JSON.stringify(b.m)),
  );
  return createHash("sha256").update(JSON.stringify(norm)).digest("hex");
}

type OrderLike = {
  id?: string | null;
  state?: string | null;
  createdAt?: string | null;
  // Square types metadata values as string | null | undefined.
  metadata?: Record<string, string | null | undefined> | null;
};

/**
 * From a customer's recent orders, find one that is the same cart (matching
 * `metadata.cart_hash`), still live (OPEN or already COMPLETED — not canceled /
 * draft), and created within `withinMs` of `now`. Returns it so the caller can
 * reuse that order instead of creating a duplicate.
 */
export function pickDuplicateOrder<T extends OrderLike>(
  orders: T[],
  hash: string,
  withinMs: number,
  now: number,
): T | null {
  for (const o of orders) {
    if (!o?.id) continue;
    if (o.metadata?.cart_hash !== hash) continue;
    if (o.state !== "OPEN" && o.state !== "COMPLETED") continue;
    const created = o.createdAt ? Date.parse(o.createdAt) : NaN;
    if (!Number.isFinite(created)) continue;
    if (now - created > withinMs) continue;
    return o;
  }
  return null;
}
