// Client-side gate for the /api/payment response — OL807 defense-in-depth
// (2026-07-06): checkout used to navigate to the confirmation page on a bare
// `json.ok`, so an ok:true response whose status said FAILED still showed
// the customer "Preparing your order" with zero money taken. The server now
// answers ok:false for dead charges; this gate keeps the client honest even
// against a stale/older server.
//
// Success shapes from /api/payment:
//   - status "COMPLETED"  — captured card
//   - status "APPROVED"   — delivery authorize-only hold
//   - alreadyPaid: true   — idempotent replay of a live-tender order
//   - status null/absent  — $0 loyalty-redeem (closed via orders.pay)
//   - status "PENDING"    — passed through unchanged (may still settle;
//     treating it as declined would invite a duplicate order)
const DEAD_PAYMENT_STATUSES = new Set(["FAILED", "CANCELED"]);

export function isPaymentAccepted(json: unknown): boolean {
  if (!json || typeof json !== "object") return false;
  const j = json as { ok?: unknown; status?: unknown; alreadyPaid?: unknown };
  if (j.ok !== true) return false;
  if (j.alreadyPaid === true) return true;
  if (typeof j.status === "string" && DEAD_PAYMENT_STATUSES.has(j.status)) {
    return false;
  }
  return true;
}
