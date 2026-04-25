import { NextResponse } from "next/server";
import {
  verifyWebhookSignature,
  mapUberStatusToSquareState,
  type UberDeliveryStatus,
} from "@/lib/uber-direct";
import { squareClient, SQUARE_LOCATION_ID } from "@/lib/square";

// Uber Direct delivery webhook. Uber POSTs status changes for active
// deliveries (pending → pickup → dropoff → delivered, plus terminal
// failed/returned/canceled). HMAC-SHA256 signature is verified against
// UBER_DIRECT_WEBHOOK_SECRET; constant-time comparison happens inside
// verifyWebhookSignature.
//
// Order lookup: we find the Square order by `external_id` (which we
// passed to Uber on dispatch as the pickup number / referenceId).
// Square's orders.search has no direct referenceId filter, so we use a
// 24h date window + client-side filter — matches the pattern in
// src/lib/order-wait.ts.
//
// Metadata: we persist `metadata.uberLastStatus` (raw uber status) in
// addition to mapping the Square fulfillment state. Necessary because
// failed/returned/canceled all collapse to Square's CANCELED — without
// the raw status, ops can't distinguish them in the dashboard.

type UberWebhookPayload = {
  event_type?: string;
  data?: {
    delivery_id?: string;
    status?: UberDeliveryStatus;
    external_id?: string;
  };
};

export async function POST(request: Request) {
  if (!SQUARE_LOCATION_ID) {
    return NextResponse.json(
      { ok: false, error: "SQUARE_LOCATION_ID not configured" },
      { status: 500 },
    );
  }

  const sig = request.headers.get("x-uber-signature") ?? "";
  const rawBody = await request.text();

  if (!verifyWebhookSignature(rawBody, sig)) {
    return NextResponse.json(
      { ok: false, error: "invalid signature" },
      { status: 401 },
    );
  }

  let payload: UberWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as UberWebhookPayload;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid json" },
      { status: 400 },
    );
  }

  const data = payload.data;
  if (!data?.delivery_id || !data.status) {
    return NextResponse.json(
      { ok: false, error: "missing fields" },
      { status: 400 },
    );
  }

  // No external_id means we can't locate the order — accept (200) so
  // Uber doesn't retry indefinitely; log for ops.
  const externalId = data.external_id;
  if (!externalId) {
    console.warn(
      `[uber-webhook] no external_id on delivery_id=${data.delivery_id}`,
    );
    return NextResponse.json({ ok: true, skipped: "no external_id" });
  }

  // Bounded recent search — we expect to find the order within the last
  // ~24h (delivery dispatch + delivery + post-completion webhook).
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  let candidates;
  try {
    const search = await squareClient.orders.search({
      locationIds: [SQUARE_LOCATION_ID],
      limit: 200,
      query: {
        filter: {
          stateFilter: { states: ["OPEN", "COMPLETED", "CANCELED"] },
          dateTimeFilter: { createdAt: { startAt: since } },
        },
        sort: {
          sortField: "CREATED_AT",
          sortOrder: "DESC",
        },
      },
    });
    candidates = search.orders ?? [];
  } catch (searchError) {
    console.error(
      "[uber-webhook] orders.search failed:",
      searchError instanceof Error ? searchError.message : searchError,
    );
    // 200 OK so Uber doesn't retry — the cron sync (T24) will reconcile.
    return NextResponse.json({ ok: true, skipped: "search failed" });
  }

  const order = candidates.find((o) => o.referenceId === externalId);
  if (!order?.id) {
    console.warn(
      `[uber-webhook] no Square order found for external_id=${externalId} (delivery_id=${data.delivery_id})`,
    );
    return NextResponse.json({ ok: true, skipped: "order not found" });
  }

  const targetState = mapUberStatusToSquareState(data.status);
  const currentFulfillment = order.fulfillments?.[0];

  // Idempotent: if state already matches AND raw status already recorded,
  // skip the update.
  const lastStatus = order.metadata?.uberLastStatus;
  if (
    currentFulfillment?.state === targetState &&
    lastStatus === data.status
  ) {
    return NextResponse.json({ ok: true, idempotent: true });
  }

  try {
    await squareClient.orders.update({
      orderId: order.id,
      order: {
        locationId: SQUARE_LOCATION_ID,
        version: order.version,
        ...(currentFulfillment
          ? {
              fulfillments: [
                {
                  ...currentFulfillment,
                  state: targetState,
                },
              ],
            }
          : {}),
        metadata: {
          ...(order.metadata ?? {}),
          uberLastStatus: data.status,
        },
      },
    });
  } catch (updateError) {
    console.error(
      "[uber-webhook] orders.update failed:",
      updateError instanceof Error ? updateError.message : updateError,
    );
    return NextResponse.json(
      { ok: false, error: "update failed" },
      { status: 502 },
    );
  }

  // T25/future: trigger push notification to customer for delivered/dropoff.

  return NextResponse.json({ ok: true });
}
