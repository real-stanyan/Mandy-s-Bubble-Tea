import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { hasLiveTender } from "@/lib/tender-state";

// "Ghost" $0 orders (OL890, 2026-09-06).
//
// A loyalty redemption is applied to the Square order BEFORE checkout's last
// step (/api/loyalty/redeem → then /api/payment closes the $0 order via
// orders.pay). If the client drops out in between — OL890's phone lost the
// redeem response ("Network request failed") after the server had already
// attached three rewards — the order is left OPEN with total $0, due $0, no
// tender and ISSUED rewards. In Square that is byte-for-byte what a SETTLED
// $0 order looks like too: orders.pay with no payment ids leaves state=OPEN,
// tenders=[] and the rewards ISSUED until staff complete the fulfillment
// (OL891 the same night: rewards flipped to REDEEMED only at COMPLETED).
//
// So Square cannot tell us. Our own ledger can: every settle path (the $0
// branch of /api/payment, the paid webhook, driver accept) writes a
// print_jobs row keyed by square_order_id before it answers. A $0 OPEN pickup
// order with no such row never finished checkout — nobody printed it, nobody
// is making it, and the customer's stars are pinned to it.
//
// Delivery orders are deliberately NOT candidates: a $0 delivery order stays
// OPEN and unprinted until a driver accepts, by design.

type OrderLike = {
  id?: string | null;
  state?: string | null;
  totalMoney?: { amount?: bigint | null } | null;
  netAmountDueMoney?: { amount?: bigint | null } | null;
  tenders?:
    | {
        id?: string | null;
        type?: string | null;
        cardDetails?: { status?: string | null } | null;
      }[]
    | null;
  metadata?: Record<string, string | null | undefined> | null;
  fulfillments?: { type?: string | null }[] | null;
};

export function netDueCents(order: OrderLike): bigint {
  const total = order.totalMoney?.amount ?? 0n;
  return order.netAmountDueMoney?.amount ?? total;
}

/**
 * A checkout that never moved money: still owes something and holds no live
 * tender. Covers both the walked-away pay sheet (no tender at all — DE888) and
 * the every-attempt-declined order (FAILED/VOIDED tenders only). Nothing to
 * print, deliver, release or nag about.
 */
export function isUnpaidCheckout(order: OrderLike): boolean {
  return netDueCents(order) > 0n && !hasLiveTender(order);
}

function isDeliveryOrder(order: OrderLike): boolean {
  return (
    order.metadata?.fulfillment_type === "DELIVERY" ||
    order.fulfillments?.[0]?.type === "DELIVERY"
  );
}

/**
 * The Square-side shape shared by settled and ghost $0 orders.
 *
 * Deliberately narrow — the print ledger is only evidence of "was this ever
 * made?" for orders WE created:
 *
 *   • metadata.source web|app — the ghost can only arise between our own
 *     /api/loyalty/redeem and /api/payment. A counter sale never runs that
 *     code. An audit on 2026-09-06 found nine $0 OPEN in-store orders from
 *     the previous month, one of them a loyalty redemption (ticket "4",
 *     20/08, Honey Black Tea): staff pulled up the reward at the POS, made
 *     the drink, and simply never closed the ticket. We never print those,
 *     so "no ledger row" says nothing about whether the customer got it —
 *     and returning the star would hand back a drink they had already drunk.
 *   • PICKUP fulfillment — every order we create is one (delivery included,
 *     see /api/orders), so IN_STORE is by definition not ours.
 *   • not delivery — a $0 delivery order stays OPEN and unprinted by design
 *     until a driver accepts.
 */
export function isZeroOpenPickupOrder(order: OrderLike): boolean {
  const source = order.metadata?.source;
  return (
    order.state === "OPEN" &&
    netDueCents(order) === 0n &&
    (order.tenders ?? []).length === 0 &&
    (source === "web" || source === "app") &&
    order.fulfillments?.[0]?.type === "PICKUP" &&
    !isDeliveryOrder(order)
  );
}

/**
 * Of the given orders, the ids of $0 OPEN pickup orders that never settled
 * (no print_jobs row). One Supabase round-trip for the whole batch; a lookup
 * failure returns the empty set — showing a ghost beats hiding a real order.
 */
export async function findGhostZeroOrderIds(
  orders: OrderLike[],
): Promise<Set<string>> {
  const candidates = orders
    .filter(isZeroOpenPickupOrder)
    .map((o) => o.id)
    .filter((id): id is string => !!id);
  if (candidates.length === 0) return new Set();
  try {
    // Either ledger counts. print_jobs is the retiring ZD411 queue (#283) but
    // every settle path still inserts into it first; cup_label_jobs is the
    // live Zebra path, written moments later via after(). Checking both keeps
    // this working through the #283 cleanup and across the after() gap.
    const admin = getSupabaseAdmin();
    const [pj, cl] = await Promise.all([
      admin.from("print_jobs").select("square_order_id").in("square_order_id", candidates),
      admin.from("cup_label_jobs").select("square_order_id").in("square_order_id", candidates),
    ]);
    if (pj.error) throw pj.error;
    if (cl.error) throw cl.error;
    const settled = new Set<string>();
    for (const rows of [pj.data, cl.data]) {
      for (const r of (rows as { square_order_id: string }[] | null) ?? []) {
        settled.add(r.square_order_id);
      }
    }
    return new Set(candidates.filter((id) => !settled.has(id)));
  } catch (err) {
    console.error("[ghost-zero-order] ledger lookup failed:", err);
    return new Set();
  }
}

/** Single-order convenience for the reward sweeps. */
export async function isGhostZeroOrder(order: OrderLike): Promise<boolean> {
  if (!order.id || !isZeroOpenPickupOrder(order)) return false;
  return (await findGhostZeroOrderIds([order])).has(order.id);
}
