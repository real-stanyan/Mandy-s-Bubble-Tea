import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { squareClient, SQUARE_LOCATION_ID } from "@/lib/square";
import { authDriver } from "@/lib/driver-auth";
import { recordDispatch, getAcceptedOrderIds } from "@/lib/driver-tokens";
import { consumeOrderDiscounts } from "@/lib/consume-order-discounts";
import { releaseDeliveryOrder } from "@/lib/release-delivery-order";

// Driver advances a delivery order: accept → picked up → delivered, or declines
// it before accepting.
//
// "accepted" CAPTURES the held card authorization — the moment the customer is
// actually charged (Mandy Delivery holds funds at checkout, charges on accept).
// "rejected" does the opposite: releases the customer (void hold + return stars
// + cancel fulfillment) — only valid before the charge, since after capture the
// money path is a refund, not a void.
// "picked_up"/"delivered" flip the Square fulfillment state (so the order moves
// through the POS like staff would advance it). Each touch also records a
// delivery_dispatch row (who drove it + timestamps).
//
//   action "accepted"  → payments.complete (charge); fulfillment stays PROPOSED
//   action "rejected"  → void hold + return stars + fulfillment CANCELED
//   action "picked_up" → fulfillment PREPARED
//   action "delivered" → fulfillment COMPLETED

export const dynamic = "force-dynamic";

const ACTION_TO_STATE = {
  picked_up: "PREPARED",
  delivered: "COMPLETED",
} as const;

type FulfillmentAction = keyof typeof ACTION_TO_STATE;
type Action = "accepted" | "rejected" | FulfillmentAction;
const VALID_ACTIONS: readonly Action[] = [
  "accepted",
  "rejected",
  "picked_up",
  "delivered",
];

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const auth = await authDriver(request);
  if (!auth.ok) {
    if (auth.reason === "unconfigured") {
      console.error("[driver/status] no driver auth configured on server");
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
        error: "action must be 'accepted', 'rejected', 'picked_up' or 'delivered'",
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

    // "Decline" releases the customer before any charge: void the held card
    // authorization, return redeemed stars, and cancel the fulfillment. Only
    // valid pre-capture — once the card is CAPTURED (accepted), the money path
    // is a refund (issue it in Square), so we refuse here rather than leave the
    // customer charged with a cancelled order.
    if (action === "rejected") {
      const tender = order.tenders?.find((t) => t.cardDetails?.status);
      if (tender?.cardDetails?.status === "CAPTURED") {
        return NextResponse.json(
          {
            ok: false,
            error: "cannot decline: order already accepted (charged) — refund it instead",
          },
          { status: 409 },
        );
      }
      const { returned, voided } = await releaseDeliveryOrder(order);
      return NextResponse.json({ ok: true, released: true, returned, voided });
    }

    // "Accept" captures the held card authorization — the moment the customer
    // is actually charged. The drink is still being made, so the fulfillment
    // stays PROPOSED; only the money moves. Idempotent: a re-tap when the
    // tender is already CAPTURED is a no-op success.
    if (action === "accepted") {
      // Accepting is a driver agreeing to deliver. For a paid order it also
      // captures the held card authorization (the actual charge). A $0 loyalty-
      // redeemed order has no card tender — nothing to capture — but a driver
      // must still accept it, so we record the acceptance without a charge.
      const tender = order.tenders?.find((t) => t.cardDetails?.status);
      const tenderStatus = tender?.cardDetails?.status;
      let captured = false;

      if (tenderStatus === "AUTHORIZED" && tender?.id) {
        await squareClient.payments.complete({ paymentId: tender.id });
        captured = true;
        // Burn any first-order discount now that the charge is real — the
        // payment route deferred this for delivery orders.
        await consumeOrderDiscounts(order).catch((e) =>
          console.error(
            "[driver/status] discount consume failed (non-fatal)",
            e,
          ),
        );
      } else if (tenderStatus && tenderStatus !== "CAPTURED") {
        // VOIDED (timed-out / cancelled) or another terminal state — can't take
        // it. (CAPTURED = already accepted → idempotent re-tap.)
        return NextResponse.json(
          {
            ok: false,
            error: `cannot accept: authorization is ${tenderStatus}`,
          },
          { status: 409 },
        );
      } else if (!tenderStatus) {
        // $0 delivery order (loyalty-comped, no card). Checkout deliberately did
        // NOT settle it (orders.pay would have completed it pre-acceptance), so
        // its checkout side-effects were deferred here: burn the discount and
        // enqueue the print. Guard on the dispatch ledger so a re-tap doesn't
        // double-consume / double-print — the AUTHORIZED branch is guarded by
        // the CAPTURED transition, but a $0 order has no such state to key on.
        const already = await getAcceptedOrderIds([orderId]);
        if (!already.has(orderId)) {
          await consumeOrderDiscounts(order).catch((e) =>
            console.error("[driver/status] $0 discount consume failed (non-fatal)", e),
          );
          try {
            const { enqueuePrintJob } = await import("@/lib/print-jobs");
            const result = await enqueuePrintJob({ order, assumeSettled: true });
            if (result.queued) {
              const { enqueueCupLabelJobs } = await import("@/lib/cup-label/enqueue");
              await enqueueCupLabelJobs({
                order,
                stickerNumber: result.stickerNumber,
              }).catch((e) =>
                console.error("[driver/status] $0 cup-label enqueue failed (non-fatal)", e),
              );
            }
          } catch (e) {
            console.error("[driver/status] $0 accept print enqueue failed (non-fatal)", e);
          }
        }
      }

      await recordDispatch({
        orderId,
        orderNumber: order.referenceId ?? order.ticketName ?? null,
        status: "accepted",
        driverLabel: body.driverLabel ?? null,
        driverId: auth.driverId ?? null,
      });
      return NextResponse.json({ ok: true, captured });
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
      driverId: auth.driverId ?? null,
    });

    return NextResponse.json({ ok: true, fulfillmentState: nextState });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[driver/status]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
