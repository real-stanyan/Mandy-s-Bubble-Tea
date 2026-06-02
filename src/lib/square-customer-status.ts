// Decide what a `customer.deleted` webhook actually means.
//
// Square fires customer.deleted in TWO cases:
//   1. A real deletion — the customer record is gone; GET returns 404.
//   2. A *merge* — the losing customer id is deleted, but GET on it still
//      resolves, redirecting to the surviving (merged-into) customer, which
//      carries a DIFFERENT id.
//
// Purging our account on a merge wrongly deletes a still-live member (their
// data lives on under the survivor id). So the webhook must only purge when
// the customer is genuinely gone. This pure function encodes that decision
// from a GET result/error so it can be unit-tested without the Square SDK.

export type DeletedCustomerClass =
  | { kind: "gone" } // genuine deletion (404) — safe to purge
  | { kind: "merged"; survivorId: string } // merged away — re-point, never purge
  | { kind: "alive" } // still resolves under the same id — unexpected; skip
  | { kind: "unknown" }; // transient/non-404 error — skip, let Square retry

export function classifyDeletedCustomerResult(
  customerId: string,
  customer: { id?: string | null } | null | undefined,
  error?: { statusCode?: number; errors?: Array<{ code?: string }> } | null,
): DeletedCustomerClass {
  if (error) {
    const notFound =
      error.statusCode === 404 ||
      (error.errors?.some((e) => e.code === "NOT_FOUND") ?? false);
    return notFound ? { kind: "gone" } : { kind: "unknown" };
  }
  if (!customer) return { kind: "gone" };
  if (customer.id && customer.id !== customerId) {
    return { kind: "merged", survivorId: customer.id };
  }
  return { kind: "alive" };
}
