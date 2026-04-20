import { NextResponse } from "next/server";
import { WebhooksHelper } from "square";
import { purgeAccount } from "@/lib/supabase";

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

  // Always ack 2xx for recognised or ignored events so Square stops
  // retrying. Unhandled event types are fine — we just don't act on them.
  return NextResponse.json({ ok: true });
}
