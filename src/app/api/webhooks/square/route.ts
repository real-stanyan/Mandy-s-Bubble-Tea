import { NextResponse, after } from "next/server";
import { WebhooksHelper, type Square } from "square";
import { getUserIdBySquareCustomer, purgeAccount } from "@/lib/supabase";
import { squareClient } from "@/lib/square";
import { classifyDeletedCustomerResult } from "@/lib/square-customer-status";
import { claimOrderPushSlot, getDevicePushTokensForUser } from "@/lib/push-tokens";
import { sendExpoPush } from "@/lib/push";
import { notifyDriversNewDelivery } from "@/lib/driver-notify";
import { enqueuePrintJob } from "@/lib/print-jobs";
import {
  reverseAccrualForOrder,
  returnRedeemedStarsForOrder,
} from "@/lib/loyalty";

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
// The online-order cup-label safety net runs in after() with a grace
// sleep (see scheduleOnlineSafetyNetBackfill). after() work counts toward
// the function budget, so allow headroom past the default 10s.
export const maxDuration = 30;

// Grace window before the webhook's online-order default backfill checks
// for cup_label_jobs. Lets the payment route's deferred (after()) enqueue
// win the INSERT so the customer's real choice prints instead of a default
// lucky cat. Env-overridable; 8s comfortably covers the ~1-2s photo path.
const ONLINE_CUP_LABEL_BACKFILL_GRACE_MS = Number(
  process.env.CUP_LABEL_BACKFILL_GRACE_MS ?? "8000",
);

// Online (web/app) orders: the payment route owns the customer's cup-label
// choices and enqueues them via after(). The webhook must NOT insert
// web-mode defaults eagerly — the printer fires on cup_label_jobs INSERT
// only, so a default (a lucky cat) inserted ahead of the deferred payment enqueue
// prints, and the real choice lands as an UPDATE that never reprints
// (photo → tarot, 2026-06-08). Instead, schedule a delayed safety-net
// backfill that only fills defaults if the order is genuinely still
// label-less after the grace window (the true OL826 dead-lambda case).
function scheduleOnlineSafetyNetBackfill(
  order: Square.Order,
  eventId: string | undefined,
) {
  after(async () => {
    try {
      const { backfillCupLabelJobsIfMissing } = await import(
        "@/lib/cup-label/backfill"
      );
      const ran = await backfillCupLabelJobsIfMissing({
        order,
        mode: "web",
        graceMs: ONLINE_CUP_LABEL_BACKFILL_GRACE_MS,
      });
      if (ran) {
        console.log(
          `[cup-label] online safety-net backfill enqueued order=${order.id} event_id=${eventId}`,
        );
      }
    } catch (e) {
      console.error("[cup-label] online safety-net backfill failed (non-fatal)", e);
    }
  });
}

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
        lifetime_points?: number;
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
 * Loyalty balance changed — also re-project the derived tier into Square
 * customer groups so the POS "Tier member 5% off" pricing rule stays correct.
 * No-ops (with a warn) until SQUARE_TIER_GROUP_*_ID env vars are configured.
 */
async function handleTierGroupSync(event: SquareEvent): Promise<void> {
  const account = event.data?.object?.loyalty_account;
  const customerId = account?.customer_id;
  if (!customerId) return;

  const { syncTierGroups, tierGroupIdsFromEnv } = await import(
    "@/lib/tier-group-sync"
  );
  const ids = tierGroupIdsFromEnv();
  if (!ids) {
    console.warn(
      "[tier-group-sync] SQUARE_TIER_GROUP_GOLD_ID/DIAMOND_ID not set — skipping",
    );
    return;
  }

  const { squareClient } = await import("@/lib/square");
  let lifetimePoints = account?.lifetime_points;
  if (typeof lifetimePoints !== "number" && account?.id) {
    const res = await squareClient.loyalty.accounts.get({
      accountId: account.id,
    });
    lifetimePoints = res.loyaltyAccount?.lifetimePoints ?? undefined;
  }
  if (typeof lifetimePoints !== "number") return;

  const plan = await syncTierGroups(squareClient, customerId, lifetimePoints, ids);
  if (plan.add.length > 0 || plan.remove.length > 0) {
    console.log(
      `[tier-group-sync] customer ${customerId} lifetime=${lifetimePoints} add=[${plan.add}] remove=[${plan.remove}] event_id=${event.event_id}`,
    );
  }
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

  // Notify drivers of a new self-delivery order. Fallback to the payment
  // route's authorization-time trigger — both are idempotent via
  // claimOrderPushSlot, so whichever fires first wins. Must never break the
  // print/loyalty flow below.
  try {
    await notifyDriversNewDelivery(order, eventId);
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
    // Webhook fires for both POS *and* API-created orders, and the two are
    // owned by different enqueuers: in-store POS has no payment route, so the
    // webhook prints immediately; online (web/app) orders are owned by the
    // payment route (which enqueues the customer's real choice via after()),
    // so the webhook must only act as a DELAYED safety net to avoid racing
    // it (photo → tarot, 2026-06-08). Square sets `order.source.name` to
    // "Point of Sale" for in-store register orders, "Mandy's Bubble Tea
    // Online Shop" for app-driven web orders, and null for some
    // server-API-created orders (verified 944 / 365 / 6 rows over 7d, Mise
    // prod mirror 2026-05-21). When unsure, treat as online — the delayed
    // safety net still backfills if no payment enqueue ever lands.
    const sourceName = order.source?.name ?? "";
    const isPosOrder = /point of sale/i.test(sourceName);
    if (isPosOrder) {
      // In-store POS: the webhook is the SOLE enqueuer (no payment route),
      // so print immediately. Each cup gets a random lucky cat by design.
      //
      // Greeting name: when a member is attached, fetch their first name so
      // the label's left column reads "Hi, {name}" (mirrors the web/app
      // path, which passes the logged-in profile's first_name). The
      // customer's name no longer prints in the number slot — see
      // print-jobs `isUsableOrderTicketName`. Non-fatal: any failure (no
      // attached customer / Square error) leaves it null → "Hi, Soul".
      let posFirstName: string | null = null;
      if (order.customerId) {
        try {
          const custRes = await squareClient.customers.get({ customerId: order.customerId });
          posFirstName = custRes?.customer?.givenName?.trim() || null;
        } catch (e) {
          console.error("[cup-label] POS customer fetch for greeting failed (non-fatal)", e);
        }
      }
      try {
        const { enqueueCupLabelJobs } = await import("@/lib/cup-label/enqueue");
        await enqueueCupLabelJobs({
          order,
          stickerNumber: result.stickerNumber,
          mode: "pos",
          customerFirstName: posFirstName,
        });
      } catch (e) {
        console.error("[cup-label] POS enqueue failed (non-fatal)", e);
      }
    } else {
      // Online order, webhook won the print_jobs claim before the payment
      // route. Don't enqueue web-mode defaults now — defer to the payment
      // route via the delayed safety net (see helper). The payment route,
      // on its own print_jobs conflict, fetches this sticker and enqueues
      // the customer's real choice.
      scheduleOnlineSafetyNetBackfill(order, eventId);
    }
  } else if (result.reason === "conflict") {
    // Expected on the 2nd+ order.updated event for the same order — but a
    // conflict is also the only signal we get when the payment route claimed
    // print_jobs and its post-response cup-label enqueue died before writing
    // any rows (OL826 2026-06-06: lambda frozen mid-flight → zero labels,
    // zero errors). Backfill with default mode if the order has no
    // cup_label_jobs; a merely-slow payment-route enqueue still wins via
    // the authoritative-upsert semantics.
    const sourceName = order.source?.name ?? "";
    if (/point of sale/i.test(sourceName)) {
      // POS conflict = a duplicate webhook for an already-enqueued POS
      // order. No payment route races here, so an immediate count-checked
      // backfill is safe (and a no-op when rows already exist).
      try {
        const { backfillCupLabelJobsIfMissing } = await import(
          "@/lib/cup-label/backfill"
        );
        const backfilled = await backfillCupLabelJobsIfMissing({
          order,
          mode: "pos",
        });
        if (backfilled) {
          console.log(
            `[cup-label] POS backfill enqueued order=${orderId} event_id=${eventId}`,
          );
        }
      } catch (e) {
        console.error("[cup-label] POS backfill failed (non-fatal)", e);
      }
    } else {
      // Online order: the payment route's deferred enqueue is the
      // authoritative source. Run the DELAYED safety net so we only fall
      // back to defaults if that enqueue genuinely never landed — never
      // racing ahead of it (photo → tarot fix, 2026-06-08).
      scheduleOnlineSafetyNetBackfill(order, eventId);
    }
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

  // Independently of accrual: if the customer SPENT stars on a reward for this
  // order, a full refund must hand those stars back too (the redeemed reward is
  // gone once the order was paid, so Square won't auto-return them). Separate
  // try/catch so an accrual-reverse failure above doesn't skip this, and vice
  // versa.
  try {
    const result = await returnRedeemedStarsForOrder(
      details.orderId,
      details.refundId,
    );
    if (result.returned > 0) {
      console.log(
        `[square-webhook] refund returned ${result.returned} redeemed stars order=${details.orderId} refund=${details.refundId} account=${result.accountId ?? "none"} event_id=${eventId}`,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[square-webhook] refund redeem-return failed order=${details.orderId} refund=${details.refundId} event_id=${eventId}: ${message}`,
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
    try {
      await handleTierGroupSync(event);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[tier-group-sync] failed event_id=${event.event_id}: ${message}`,
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
