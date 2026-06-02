import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { squareClient, SQUARE_LOCATION_ID } from "@/lib/square";
import { isAuthedDriver } from "@/lib/driver-auth";
import { recordDispatch } from "@/lib/driver-tokens";

// Driver marks a delivery order picked up / delivered.
//
// We flip the Square fulfillment state (so the order moves through the POS
// the same way staff would advance it) AND record a delivery_dispatch row
// (who drove it + timestamps). The Square write is the source of truth for
// the order's lifecycle; the dispatch row is delivery-specific bookkeeping.
//
//   action "picked_up" → fulfillment PREPARED
//   action "delivered" → fulfillment COMPLETED

export const dynamic = "force-dynamic";

const ACTION_TO_STATE = {
  picked_up: "PREPARED",
  delivered: "COMPLETED",
} as const;

type Action = keyof typeof ACTION_TO_STATE;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const auth = isAuthedDriver(request);
  if (!auth.ok) {
    if (auth.reason === "unconfigured") {
      console.error("[driver/status] STAFF_DELIVERY_TOKEN not set on server");
      return NextResponse.json({ ok: false }, { status: 500 });
    }
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { orderId } = await params;

  let body: { action?: string; driverLabel?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const action = body.action as Action | undefined;
  if (!action || !(action in ACTION_TO_STATE)) {
    return NextResponse.json(
      { ok: false, error: "action must be 'picked_up' or 'delivered'" },
      { status: 400 },
    );
  }

  try {
    // Need the current version + the fulfillment uid for a sparse update.
    const current = await squareClient.orders.get({ orderId });
    const order = current.order;
    const fulfillment = order?.fulfillments?.[0];
    if (!order || !fulfillment?.uid || order.version == null) {
      return NextResponse.json(
        { ok: false, error: "order or fulfillment not found" },
        { status: 404 },
      );
    }
    // Guard: only operate on self-delivery orders.
    if (order.metadata?.fulfillment_type !== "DELIVERY") {
      return NextResponse.json(
        { ok: false, error: "not a delivery order" },
        { status: 409 },
      );
    }

    const nextState = ACTION_TO_STATE[action];

    // Apply the fulfillment-state change with a version-conflict retry.
    // The order version can move between our get and update — e.g. staff
    // advancing the same ticket in Square POS, or Square's own background
    // settlement. On VERSION_MISMATCH we re-read the latest version + uid
    // and try again (the operation is idempotent: setting an already-set
    // state is a no-op).
    let version = order.version;
    let uid = fulfillment.uid;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await squareClient.orders.update({
          orderId,
          order: {
            locationId: SQUARE_LOCATION_ID,
            version,
            fulfillments: [{ uid, state: nextState }],
          },
          idempotencyKey: randomUUID(),
        });
        break;
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        const isVersionConflict = /VERSION_MISMATCH/.test(text);
        if (!isVersionConflict || attempt === 2) throw err;
        const fresh = (await squareClient.orders.get({ orderId })).order;
        if (fresh?.version == null || !fresh.fulfillments?.[0]?.uid) throw err;
        version = fresh.version;
        uid = fresh.fulfillments[0].uid;
      }
    }

    await recordDispatch({
      orderId,
      orderNumber: order.referenceId ?? order.ticketName ?? null,
      status: action,
      driverLabel: body.driverLabel ?? null,
    });

    return NextResponse.json({ ok: true, fulfillmentState: nextState });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[driver/status]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
