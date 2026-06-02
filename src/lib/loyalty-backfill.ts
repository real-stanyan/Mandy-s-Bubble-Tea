import "server-only";
import { squareClient } from "@/lib/square";
import { findOrCreateLoyaltyAccount, accrueForOrder } from "@/lib/loyalty";
import {
  claimBackfillSlot,
  releaseBackfillSlot,
  recordBackfillResult,
  type BackfillSource,
} from "@/lib/loyalty-backfill-log";

export type BackfillResult =
  | { status: "accrued"; accountId: string }
  | { status: "already" }
  | {
      status: "skipped";
      reason: "not_paid" | "no_customer" | "no_phone" | "already_logged" | "error";
      detail?: string;
    };

/**
 * Settled-payment gate. Mirrors the logic in src/lib/print-jobs.ts:
 * COMPLETED orders (incl. $0 redemptions) count; otherwise require a
 * CAPTURED card tender (non-card tenders count as settled). FAILED /
 * VOIDED card tenders do NOT count.
 */
function isOrderSettled(order: {
  state?: string;
  tenders?: Array<{ type?: string; cardDetails?: { status?: string } }>;
}): boolean {
  const isCompleted = order.state === "COMPLETED";
  const hasSettledTender = (order.tenders ?? []).some((t) =>
    t.type === "CARD" ? t.cardDetails?.status === "CAPTURED" : true,
  );
  return isCompleted || hasSettledTender;
}

/**
 * Backfill a loyalty star for an order that has a customer attached but
 * never accrued. Idempotent and safe to call from the webhook, the cron
 * sweep, and the retro script. Never throws — returns a result enum.
 */
export async function backfillAccrualForOrder(
  orderId: string,
  source: BackfillSource,
): Promise<BackfillResult> {
  // 1. Fetch + payment gate
  let order;
  try {
    const resp = await squareClient.orders.get({ orderId });
    order = resp.order;
  } catch (err) {
    return { status: "skipped", reason: "error", detail: String(err) };
  }
  if (!order || !isOrderSettled(order)) {
    return { status: "skipped", reason: "not_paid" };
  }
  const customerId = order.customerId;
  if (!customerId) {
    return { status: "skipped", reason: "no_customer" };
  }

  // 2. L1: claim the slot (concurrency + idempotency guard)
  const claimed = await claimBackfillSlot(orderId, source);
  if (!claimed) {
    return { status: "skipped", reason: "already_logged" };
  }

  try {
    // 3. L2: skip if any accrual already exists for this order
    const ev = await squareClient.loyalty.searchEvents({
      query: {
        filter: {
          orderFilter: { orderId },
          typeFilter: { types: ["ACCUMULATE_POINTS"] },
        },
      },
    });
    if ((ev.events ?? []).length > 0) {
      await releaseBackfillSlot(orderId);
      return { status: "already" };
    }

    // 4. Resolve phone, enroll if needed
    const custResp = await squareClient.customers.get({ customerId });
    const phone = custResp.customer?.phoneNumber;
    if (!phone) {
      await releaseBackfillSlot(orderId);
      return { status: "skipped", reason: "no_phone" };
    }
    const account = await findOrCreateLoyaltyAccount(customerId, phone);

    // 5. L3: accrue with a stable idempotency key
    await accrueForOrder(account.accountId, orderId, `backfill:${orderId}`);
    await recordBackfillResult(orderId, account.accountId);
    return { status: "accrued", accountId: account.accountId };
  } catch (err) {
    await releaseBackfillSlot(orderId);
    return { status: "skipped", reason: "error", detail: String(err) };
  }
}
