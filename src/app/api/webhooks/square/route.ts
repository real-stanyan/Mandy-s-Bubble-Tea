import { NextResponse } from "next/server";
import { WebhooksHelper, type Square } from "square";
import { getUserIdBySquareCustomer, purgeAccount } from "@/lib/supabase";
import { squareClient } from "@/lib/square";
import { classifyDeletedCustomerResult } from "@/lib/square-customer-status";
import { claimOrderPushSlot, getDevicePushTokensForUser } from "@/lib/push-tokens";
import { sendExpoPush } from "@/lib/push";
import { getAllDriverPushTokens } from "@/lib/driver-tokens";
import { enqueuePrintJob } from "@/lib/print-jobs";
import { reverseAccrualForOrder } from "@/lib/loyalty";

// Square Webhook endpoint. Subscribed events (configured in Square
// Developer Dashboard):
//
//   - customer.deleted — when a merchant deletes a Square customer from
//     the Dashboard, cascade-delete the matching Supabase auth.users row
//     (user_profiles follows via FK) and the welcome_discounts row.
//     This makes Square Dashboard deletion the authoritative "remove
//     account" action; next time that person signs in with Apple/Google
//     they start fresh and re-earn the 30% welcome discount.
//
// Signature verification uses WebhooksHelper.verifySignature from the
// Square SDK, which expects the raw request body — we read with
// request.text() and parse AFTER verification.

export const dynamic = "force-dynamic";

// Square's webhook payload shape varies per event family. `customer.deleted`
// is documented as `{ data: { type: "customer", id: "<id>", deleted: true } }`
// but other event types wrap the resource inside `data.object.<resource>`.
// Allow either shape here so a mis-remembered contract doesn't cost us a
// silent no-op in production; the pickCustomerId helper below probes both.
type SquareFulfillmentUpdate = {
  fulfillment_uid?: string;
  old_state?: string;
  new_state?: string;
};

type SquareEvent = {
  type?: string;
  event_id?: string;
  data?: {
    id?: string;
    type?: string;
    object?: {
      customer?: { id?: string };
      order_fulfillment_updated?: {
        order_id?: string;
        state?: string;
        fulfillment_update?: SquareFulfillmentUpdate[];
      };
      loyalty_account?: {
        id?: string;
        customer_id?: string;
        balance?: number;
      };
      order_updated?: {
        order_id?: string;
        state?: string;
        version?: number;
      };
      refund?: {
        id?: string;
        order_id?: string;
        payment_id?: string;
        status?: string;
        amount_money?: { amount?: number | bigint; currency?: string };
      };
    };
  };
};

type RefundDetails = {
  refundId: string;
  orderId: string;
  status: string;
  amountCents: number;
};

function pickCustomerId(event: SquareEvent): string | null {
  return (
    event.data?.id ??
    event.data?.object?.customer?.id ??
    null
  );
}

/**
 * Returns the order id when an order.fulfillment.updated event
 * includes at least one fulfillment transitioning to PREPARED
 * (Square's "ready for pickup" state). Returns null for any other
 * event or transition so the caller can skip cheaply.
 */
function pickReadyOrderId(event: SquareEvent): string | null {
  const payload = event.data?.object?.order_fulfillment_updated;
  if (!payload) return null;
  const updates = payload.fulfillment_update ?? [];
  const toPrepared = updates.some((u) => u.new_state === "PREPARED");
  if (!toPrepared) return null;
  return payload.order_id ?? null;
}

/**
 * Returns the order_id on an order.updated event, regardless of state.
 * The caller will gate on payment presence after fetching the full order.
 */
function pickUpdatedOrderId(event: SquareEvent): string | null {
  const payload = event.data?.object?.order_updated;
  if (!payload) return null;
  return payload.order_id ?? null;
}

/**
 * Extract the refund details needed to decide whether to reverse stars.
 * Returns null for events that don't carry a refund payload or are
 * missing required fields.
 */
function pickRefundDetails(event: SquareEvent): RefundDetails | null {
  const r = event.data?.object?.refund;
  if (!r?.id || !r.order_id || !r.status) return null;
  const amt = r.amount_money?.amount;
  const amountCents = typeof amt === "bigint" ? Number(amt) : Number(amt ?? 0);
  if (!Number.isFinite(amountCents)) return null;
  return {
    refundId: r.id,
    orderId: r.order_id,
    status: r.status,
    amountCents,
  };
}

/**
 * Called when an order.fulfillment.updated event transitions at least
 * one fulfillment to PREPARED. Fetches the Square order to find the
 * customer id, maps to a Supabase user, claims the dedup slot, and
 * sends the push. All errors are logged; the webhook still ACKs 2xx
 * so Square doesn't spin on retries.
 */
async function handleOrderReady(orderId: string, eventId?: string): Promise<void> {
  let customerId: string | null = null;
  let ticketName: string | null = null;
  try {
    const resp = await squareClient.orders.get({ orderId });
    customerId = resp.order?.customerId ?? null;
    ticketName = resp.order?.ticketName ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[square-webhook] orders.get ${orderId} failed: ${message}`);
    return;
  }

  if (!customerId) {
    console.log(`[square-webhook] order ${orderId} has no customer_id — skipping push`);
    return;
  }

  const userId = await getUserIdBySquareCustomer(customerId);
  if (!userId) {
    console.log(
      `[square-webhook] Square customer ${customerId} has no Supabase profile — skipping push`,
    );
    return;
  }

  const tokens = await getDevicePushTokensForUser(userId);
  if (tokens.length === 0) {
    console.log(`[square-webhook] user ${userId} has no registered devices`);
    return;
  }

  const claimed = await claimOrderPushSlot(orderId, "ready");
  if (!claimed) {
    console.log(
      `[square-webhook] order ${orderId} ready push already sent (event_id=${eventId})`,
    );
    return;
  }

  const displayNumber = ticketName ?? `#${orderId.slice(-4).toUpperCase()}`;
  const accepted = await sendExpoPush(
    tokens.map((t) => t.token),
    {
      title: "Your order is ready 🧋",
      body: `Order ${displayNumber} is ready for pickup at Mandy's Bubble Tea.`,
      data: { orderId, kind: "ready" },
    },
  );
  console.log(
    `[square-webhook] sent ready push for order ${orderId} to ${accepted}/${tokens.length} devices`,
  );
}

/**
 * Loyalty balance changed — if the customer has a wallet pass,
 * enqueue a QStash job to bump updated_at + push to APNs. The worker
 * route does the heavy lifting; the webhook just fans out the signal
 * and ACKs Square fast.
 */
async function handleLoyaltyBalanceUpdate(event: SquareEvent): Promise<void> {
  const customerId = event.data?.object?.loyalty_account?.customer_id;
  if (!customerId) {
    console.log(
      `[square-webhook] loyalty.account.updated missing customer_id event_id=${event.event_id}`,
    );
    return;
  }

  const { getPassByCustomerId } = await import("@/lib/wallet/db");
  const pass = await getPassByCustomerId(customerId);
  if (!pass) {
    return;
  }

  const { Client: QStashClient } = await import("@upstash/qstash");
  const { walletEnv } = await import("@/lib/wallet/env");
  const env = walletEnv();
  const qstash = new QStashClient({ token: env.qstashToken, baseUrl: env.qstashUrl });
  const workerUrl = `${env.webServiceUrl.replace(/\/api\/wallet\/?$/, "")}/api/wallet/worker/push`;

  await qstash.publishJSON({
    url: workerUrl,
    body: { serialNumber: pass.serial_number },
    retries: 3,
  });

  console.log(
    `[square-webhook] enqueued wallet push for customer ${customerId} serial=${pass.serial_number} event_id=${event.event_id}`,
  );
}

/**
 * Fallback path: enqueue a delayed loyalty-backfill job. handleOrderPaid
 * now accrues inline (immediately) on the webhook; this queue is only used
 * when that inline attempt hits a transient error, giving a retry with
 * QStash's own retry policy on top. The cron sweep is the final backstop.
 * Square dedups accrual by orderId, so neither this nor native can double.
 */
async function enqueueLoyaltyBackfill(orderId: string): Promise<void> {
  const { Client: QStashClient } = await import("@upstash/qstash");
  const { walletEnv } = await import("@/lib/wallet/env");
  const env = walletEnv();
  const qstash = new QStashClient({ token: env.qstashToken, baseUrl: env.qstashUrl });
  const workerUrl = `${env.webServiceUrl.replace(/\/api\/wallet\/?$/, "")}/api/loyalty/backfill-worker`;
  await qstash.publishJSON({
    url: workerUrl,
    body: { orderId },
    delay: "90s",
    retries: 3,
  });
}

/**
 * Called on order.updated. Fetches the full order, checks it is paid,
 * then enqueues a cup-sticker print job. Idempotent via
 * unique(square_order_id) on print_jobs.
 */
/**
 * Push a "new delivery" alert to all registered driver devices when a paid
 * self-delivery order lands. Self-delivery orders are PICKUP fulfillments
 * tagged metadata.fulfillment_type=DELIVERY. Idempotent via the
 * order_push_notifications ledger (kind='new_delivery') so Square's webhook
 * retries don't double-notify.
 */
async function maybeNotifyDriversNewDelivery(
  order: Square.Order,
  eventId?: string,
): Promise<void> {
  if (order.metadata?.fulfillment_type !== "DELIVERY") return;
  const orderId = order.id;
  if (!orderId) return;

  // Paid check — same netAmountDue===0 signal used everywhere else.
  const total = order.totalMoney?.amount ?? 0n;
  const due = order.netAmountDueMoney?.amount ?? total;
  if (due !== 0n) return;

  const claimed = await claimOrderPushSlot(orderId, "new_delivery");
  if (!claimed) return;

  const tokens = await getAllDriverPushTokens();
  if (tokens.length === 0) return;

  const number = order.referenceId ?? order.ticketName ?? "";
  const address = (order.metadata?.delivery_address as string | undefined) ?? "";
  const accepted = await sendExpoPush(tokens, {
    title: "New delivery 🚚",
    body: [number, address].filter(Boolean).join(" · ") || "New delivery order",
    data: { orderId, kind: "new_delivery" },
  });
  console.log(
    `[driver-push] new delivery ${number} → ${accepted}/${tokens.length} event_id=${eventId}`,
  );
}

async function handleOrderPaid(orderId: string, eventId?: string): Promise<void> {
  let order;
  try {
    const resp = await squareClient.orders.get({ orderId });
    order = resp.order;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[print] orders.get ${orderId} failed: ${message}`);
    return;
  }
  if (!order) {
    console.log(`[print] orders.get returned no order for ${orderId}`);
    return;
  }

  // Notify drivers of a new self-delivery order. Non-blocking + idempotent
  // (claimOrderPushSlot dedupes Square's webhook retries). Must never break
  // the print/loyalty flow below.
  try {
    await maybeNotifyDriversNewDelivery(order, eventId);
  } catch (e) {
    console.error("[driver-push] notify failed (non-fatal)", e);
  }

  const result = await enqueuePrintJob({ order });
  if (result.queued) {
    console.log(
      `[print] queued order ${orderId} as ${result.stickerNumber} event_id=${eventId}`,
    );

    // Cup-label (Zebra) parallel path — non-blocking, must never break the legacy print_jobs flow.
    //
    // Webhook fires for both POS *and* API-created orders. We only want
    // fortune-mode for true in-store POS orders so we don't race the
    // app's payment route and overwrite a logged-in user's doodle
    // choice with a fortune. Square sets `order.source.name` to
    // "Point of Sale" for in-store register orders, "Mandy's Bubble Tea
    // Online Shop" for app-driven web orders, and null for some
    // server-API-created orders. Verified by aggregating 944 / 365 / 6
    // rows across 7d of Mise's prod orders mirror (2026-05-21). When
    // unsure, default to "web" mode (hash POOL preset / web doodleIds)
    // — that matches the pre-fortune behavior, so the worst case for a
    // misclassified order is the old behavior.
    const sourceName = order.source?.name ?? "";
    const isPosOrder = /point of sale/i.test(sourceName);
    const cupLabelMode = isPosOrder ? "pos" : "web";
    try {
      const { enqueueCupLabelJobs } = await import("@/lib/cup-label/enqueue");
      await enqueueCupLabelJobs({
        order,
        stickerNumber: result.stickerNumber,
        mode: cupLabelMode,
      });
    } catch (e) {
      console.error("[cup-label] enqueue failed (non-fatal)", e);
    }
  } else if (result.reason === "conflict") {
    // Expected on the 2nd+ order.updated event for the same order.
  } else if (result.reason === "not_paid") {
    // Expected for order.updated events before payment posts.
  } else {
    console.error(
      `[print] enqueue skipped order=${orderId} reason=${result.reason}${
        result.detail ? ` detail=${result.detail}` : ""
      } event_id=${eventId}`,
    );
  }

  // Loyalty: accrue the star IMMEDIATELY (inline) so an in-store member's
  // star lands at the counter, not minutes later. Square dedups accrual by
  // orderId (verified in prod), so racing Square's own native POS check-in
  // can NOT double-count — whichever lands first wins, the other is a no-op.
  // This removes the old delayed-queue lag that forced staff to hand-add
  // stars. On a transient failure we fall back to the delayed queue, and the
  // 15-min cron sweep remains the final backstop, so nothing is ever lost.
  if (order.customerId) {
    try {
      const { backfillAccrualForOrder } = await import("@/lib/loyalty-backfill");
      const result = await backfillAccrualForOrder(orderId, "webhook");
      console.log(
        `[loyalty] inline accrual order ${orderId}: ${result.status}${
          result.status === "skipped" ? `/${result.reason}` : ""
        } event_id=${eventId}`,
      );
      // Only a transient Square/network error warrants a retry; not_paid
      // (a pre-payment order.updated) will be handled by a later webhook or
      // the cron sweep, and already/accrued/no_customer are terminal.
      if (result.status === "skipped" && result.reason === "error") {
        await enqueueLoyaltyBackfill(orderId);
      }
    } catch (e) {
      console.error("[loyalty] inline accrual threw — falling back to queue", e);
      try {
        await enqueueLoyaltyBackfill(orderId);
      } catch (e2) {
        console.error("[loyalty] queue fallback also failed (non-fatal)", e2);
      }
    }
  }
}

/**
 * Refund landed (refund.created or refund.updated with status=COMPLETED).
 * Reverses any loyalty stars that were earned for the underlying order
 * via a negative Square loyalty.accounts.adjust. Partial refunds are
 * logged but not auto-reversed — those are rare and the policy is
 * "manual review" to avoid mis-clawing a legitimate accrual.
 */
async function handleRefund(
  details: RefundDetails,
  eventId?: string,
): Promise<void> {
  if (details.status !== "COMPLETED") {
    return;
  }

  let orderTotal: number | null = null;
  try {
    const resp = await squareClient.orders.get({ orderId: details.orderId });
    const amt = resp.order?.totalMoney?.amount;
    if (amt != null) {
      orderTotal = typeof amt === "bigint" ? Number(amt) : Number(amt);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[square-webhook] refund order fetch failed order=${details.orderId} refund=${details.refundId}: ${message}`,
    );
    return;
  }

  if (orderTotal != null && details.amountCents < orderTotal) {
    console.warn(
      `[square-webhook] partial refund order=${details.orderId} refund=${details.refundId} refunded=${details.amountCents} total=${orderTotal} — NOT auto-reversing stars (manual review)`,
    );
    return;
  }

  try {
    const result = await reverseAccrualForOrder(details.orderId, details.refundId);
    console.log(
      `[square-webhook] refund reversed ${result.reversed} stars order=${details.orderId} refund=${details.refundId} account=${result.accountId ?? "none"} event_id=${eventId}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[square-webhook] refund reverse failed order=${details.orderId} refund=${details.refundId} event_id=${eventId}: ${message}`,
    );
  }
}

export async function POST(request: Request) {
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  const notificationUrl = process.env.SQUARE_WEBHOOK_NOTIFICATION_URL;
  if (!signatureKey || !notificationUrl) {
    console.error(
      "[square-webhook] SQUARE_WEBHOOK_SIGNATURE_KEY or SQUARE_WEBHOOK_NOTIFICATION_URL missing",
    );
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  const signatureHeader =
    request.headers.get("x-square-hmacsha256-signature") ??
    request.headers.get("X-Square-HmacSha256-Signature");
  if (!signatureHeader) {
    return NextResponse.json(
      { ok: false, error: "Missing signature" },
      { status: 401 },
    );
  }

  const rawBody = await request.text();
  const valid = await WebhooksHelper.verifySignature({
    requestBody: rawBody,
    signatureHeader,
    signatureKey,
    notificationUrl,
  });
  if (!valid) {
    console.warn("[square-webhook] signature verification failed");
    return NextResponse.json(
      { ok: false, error: "Invalid signature" },
      { status: 401 },
    );
  }

  let event: SquareEvent;
  try {
    event = JSON.parse(rawBody) as SquareEvent;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON" },
      { status: 400 },
    );
  }

  if (event.type === "customer.deleted") {
    const customerId = pickCustomerId(event);
    if (!customerId) {
      // Full dump only when we hit the unexpected shape branch, so the
      // happy path stays quiet.
      console.warn(
        `[square-webhook] customer.deleted missing customer id. event_id=${event.event_id} data=${JSON.stringify(event.data)}`,
      );
      return NextResponse.json({ ok: true });
    }
    // customer.deleted ALSO fires for the losing id of a Square *merge*,
    // where the id still resolves (GET redirects to the surviving customer
    // under a different id). Purging then wrongly deletes a still-live
    // member. So confirm with Square that the customer is genuinely gone
    // (404) before purging; on a merge / still-alive / transient error we
    // skip — the merged-id re-point is handled out of band.
    let customer: { id?: string | null } | null = null;
    let getError: { statusCode?: number; errors?: Array<{ code?: string }> } | null =
      null;
    try {
      const res = await squareClient.customers.get({ customerId });
      customer = res?.customer ?? null;
    } catch (err) {
      getError = err as { statusCode?: number; errors?: Array<{ code?: string }> };
    }
    const cls = classifyDeletedCustomerResult(customerId, customer, getError);
    if (cls.kind === "gone") {
      await purgeAccount({ customerId });
      console.log(
        `[square-webhook] purged Supabase account for Square customer ${customerId} event_id=${event.event_id}`,
      );
    } else {
      console.warn(
        `[square-webhook] customer.deleted for ${customerId} NOT purged (kind=${cls.kind}${
          cls.kind === "merged" ? `, survivor=${cls.survivorId}` : ""
        }) event_id=${event.event_id}`,
      );
    }
  }

  if (event.type === "order.fulfillment.updated") {
    const orderId = pickReadyOrderId(event);
    if (orderId) {
      try {
        await handleOrderReady(orderId, event.event_id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[square-webhook] handleOrderReady failed for order ${orderId} event_id=${event.event_id}: ${message}`,
        );
      }
    }
  }

  if (event.type === "loyalty.account.updated") {
    try {
      await handleLoyaltyBalanceUpdate(event);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[square-webhook] handleLoyaltyBalanceUpdate failed event_id=${event.event_id}: ${message}`,
      );
    }
  }

  if (event.type === "order.updated") {
    const orderId = pickUpdatedOrderId(event);
    if (orderId) {
      try {
        await handleOrderPaid(orderId, event.event_id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[print] handleOrderPaid threw for order ${orderId} event_id=${event.event_id}: ${message}`,
        );
      }
    }
  }

  if (event.type === "refund.created" || event.type === "refund.updated") {
    const refund = pickRefundDetails(event);
    if (refund) {
      try {
        await handleRefund(refund, event.event_id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[square-webhook] handleRefund threw refund=${refund.refundId} event_id=${event.event_id}: ${message}`,
        );
      }
    }
  }

  // Always ack 2xx for recognised or ignored events so Square stops
  // retrying. Unhandled event types are fine — we just don't act on them.
  return NextResponse.json({ ok: true });
}
