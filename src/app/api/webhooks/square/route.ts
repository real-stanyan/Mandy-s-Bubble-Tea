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

type SquareEvent = {
  type?: string;
  data?: {
    id?: string;
    type?: string;
  };
};

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
    const customerId = event.data?.id;
    if (!customerId) {
      console.warn("[square-webhook] customer.deleted missing data.id", event);
      return NextResponse.json({ ok: true });
    }
    await purgeAccount({ customerId });
    console.log(
      `[square-webhook] purged Supabase account linked to Square customer ${customerId}`,
    );
  }

  // Always ack 2xx for recognised or ignored events so Square stops
  // retrying. Unhandled event types are fine — we just don't act on them.
  return NextResponse.json({ ok: true });
}
