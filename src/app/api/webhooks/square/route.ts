import { NextResponse } from "next/server";
import { WebhooksHelper } from "square";
import { getUserIdBySquareCustomer, purgeAccount } from "@/lib/supabase";
import { squareClient } from "@/lib/square";
import { claimOrderPushSlot, getDevicePushTokensForUser } from "@/lib/push-tokens";
import { sendExpoPush } from "@/lib/push";
import { enqueuePrintJob } from "@/lib/print-jobs";

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
    };
  };
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

  const result = await enqueuePrintJob({ order });
  if (result.queued) {
    console.log(
      `[print] queued order ${orderId} as ${result.stickerNumber} event_id=${eventId}`,
    );

    // CloudPRNT (TSP100) parallel path — non-blocking, must never break the legacy print_jobs flow.
    try {
      const { enqueueCupLabelJobs } = await import("@/lib/cup-label/enqueue");
      await enqueueCupLabelJobs({ order, stickerNumber: result.stickerNumber });
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
    await purgeAccount({ customerId });
    console.log(
      `[square-webhook] purged Supabase account for Square customer ${customerId} event_id=${event.event_id}`,
    );
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

  // Always ack 2xx for recognised or ignored events so Square stops
  // retrying. Unhandled event types are fine — we just don't act on them.
  return NextResponse.json({ ok: true });
}
