import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { squareClient, SQUARE_LOCATION_ID } from "@/lib/square";
import { isAuthedDriver } from "@/lib/driver-auth";
import { recordDispatch } from "@/lib/driver-tokens";
import { consumeOrderDiscounts } from "@/lib/consume-order-discounts";

// Driver advances a delivery order: accept → picked up → delivered.
//
// "accepted" CAPTURES the held card authorization — the moment the customer is
// actually charged (Mandy Delivery holds funds at checkout, charges on accept).
// "picked_up"/"delivered" flip the Square fulfillment state (so the order moves
// through the POS like staff would advance it). Each touch also records a
// delivery_dispatch row (who drove it + timestamps).
//
//   action "accepted"  → payments.complete (charge); fulfillment stays PROPOSED
//   action "picked_up" → fulfillment PREPARED
//   action "delivered" → fulfillment COMPLETED

export const dynamic = "force-dynamic";

const ACTION_TO_STATE = {
  picked_up: "PREPARED",
  delivered: "COMPLETED",
} as const;

type FulfillmentAction = keyof typeof ACTION_TO_STATE;
type Action = "accepted" | FulfillmentAction;
const VALID_ACTIONS: readonly Action[] = ["accepted", "picked_up", "delivered"];

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

  // Admin is a read-only monitor — never mutates order state or GPS.
  if (auth.role === "admin") {
    return NextResponse.json(
      { ok: false, error: "Admin is read-only" },
      { status: 403 },
    );
  }

  const { orderId } = await params;

  let body: { action?: string; driverLabel?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const action = body.action as Action | undefined;
  if (!action || !VALID_ACTIONS.includes(action)) {
    return NextResponse.json(
      {
        ok: false,
        error: "action must be 'accepted', 'picked_up' or 'delivered'",
      },
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

    // "Accept" captures the held card authorization — the moment the customer
    // is actually charged. The drink is still being made, so the fulfillment
    // stays PROPOSED; only the money moves. Idempotent: a re-tap when the
    // tender is already CAPTURED is a no-op success.
    if (action === "accepted") {
      const tender = order.tenders?.find((t) => t.cardDetails?.status);
      const paymentId = tender?.id;
      const tenderStatus = tender?.cardDetails?.status;
      if (!paymentId) {
        return NextResponse.json(
          { ok: false, error: "no card authorization to capture" },
          { status: 409 },
        );
      }
      if (tenderStatus === "AUTHORIZED") {
        await squareClient.payments.complete({ paymentId });
        // Burn any first-order discount now that the charge is real — the
        // payment route deferred this for delivery orders.
        await consumeOrderDiscounts(order).catch((e) =>
          console.error(
            "[driver/status] discount consume failed (non-fatal)",
            e,
          ),
        );
      } else if (tenderStatus !== "CAPTURED") {
        // VOIDED (timed-out / cancelled) or another terminal state.
        return NextResponse.json(
          {
            ok: false,
            error: `cannot accept: authorization is ${tenderStatus}`,
          },
          { status: 409 },
        );
      }
      await recordDispatch({
        orderId,
        orderNumber: order.referenceId ?? order.ticketName ?? null,
        status: "accepted",
        driverLabel: body.driverLabel ?? null,
      });
      return NextResponse.json({ ok: true, captured: true });
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
