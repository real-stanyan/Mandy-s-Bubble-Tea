// Picking the right card tender off a Square order.
//
// An order can carry MORE THAN ONE card tender: when a customer's first card
// is declined and they retry with another (or the same) card, Square keeps the
// FAILED tender AND adds the new AUTHORIZED one. Naively taking
// `tenders.find(t => t.cardDetails?.status)` grabs whichever is first in the
// array — often the FAILED one — and makes downstream logic believe the order
// is unpayable. (This was the DE831 bug: a valid AUTHORIZED hold sat behind a
// FAILED first attempt, so the driver app refused to accept it.)
//
// "Active" = a tender that actually represents money on the hook:
//   AUTHORIZED (held, capturable) > CAPTURED (already charged).
// FAILED / VOIDED tenders are dead and ignored.

type CardTenderLike = {
  id?: string | null;
  cardDetails?: { status?: string | null } | null;
};

/**
 * Return the live card tender for an order, preferring an AUTHORIZED hold
 * (still capturable) over an already-CAPTURED one. Ignores FAILED/VOIDED
 * tenders entirely. Returns undefined when no card tender is live (e.g. a $0
 * loyalty-comped order, or every attempt failed/voided).
 */
export function pickActiveCardTender<T extends CardTenderLike>(
  tenders: readonly T[] | null | undefined,
): T | undefined {
  if (!tenders?.length) return undefined;
  return (
    tenders.find((t) => t.cardDetails?.status === "AUTHORIZED") ??
    tenders.find((t) => t.cardDetails?.status === "CAPTURED") ??
    undefined
  );
}

/** Any card tender at all (live or dead) — distinguishes a $0 order (none)
 * from one whose every payment attempt failed/voided (some, but none active). */
export function hasAnyCardTender(
  tenders: readonly CardTenderLike[] | null | undefined,
): boolean {
  return tenders?.some((t) => !!t.cardDetails?.status) ?? false;
}
