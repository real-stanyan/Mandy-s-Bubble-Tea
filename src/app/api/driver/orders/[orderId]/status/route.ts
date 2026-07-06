import { NextResponse, after } from "next/server";
import { randomUUID } from "node:crypto";
import { squareClient, SQUARE_LOCATION_ID } from "@/lib/square";
import { authDriver } from "@/lib/driver-auth";
import { recordDispatch, getAcceptedOrderIds } from "@/lib/driver-tokens";
import { sendLiveActivityStatusPush } from "@/lib/live-activity";
import { consumeOrderDiscounts } from "@/lib/consume-order-discounts";
import { releaseDeliveryOrder } from "@/lib/release-delivery-order";
import { pickActiveCardTender, hasAnyCardTender } from "@/lib/order-tender";

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

// Live Activity mirror of the dispatch transition. Deferred via after() +
// internally try/caught in the lib, so a push failure can never affect the
// driver's response. Idempotent via the la_* push-slot kinds (a re-tap
// claims the same slot and no-ops).
const LIVE_ACTIVITY_FOR_ACTION = {
  accepted: { kind: "la_accepted", status: "accepted", event: "update" },
  picked_up: { kind: "la_picked_up", status: "picked_up", event: "update" },
  delivered: { kind: "la_delivered", status: "delivered", event: "end" },
} as const;

function scheduleLiveActivityPush(
  orderId: string,
  action: keyof typeof LIVE_ACTIVITY_FOR_ACTION,
  driverName: string | null,
) {
  const push = LIVE_ACTIVITY_FOR_ACTION[action];
  after(async () => {
    try {
      await sendLiveActivityStatusPush({
        orderId,
        kind: push.kind,
        status: push.status,
        event: push.event,
        driverName,
      });
    } catch (err) {
      // sendLiveActivityStatusPush already swallows its own errors; this
      // catch is a belt-and-braces so after() can never surface a rejection.
      console.error(
        `[live-activity] ${action} push scheduling failed order=${orderId}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  });
}

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
      const active = pickActiveCardTender(order.tenders);
      if (active?.cardDetails?.status === "CAPTURED") {
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
      // An order can hold MULTIPLE card tenders: a declined first attempt leaves
      // a FAILED tender alongside the AUTHORIZED retry. Pick the LIVE one so a
      // valid hold sitting behind a FAILED attempt is still captured (DE831 bug).
      const active = pickActiveCardTender(order.tenders);
      const activeStatus = active?.cardDetails?.status;
      let captured = false;

      if (activeStatus === "AUTHORIZED" && active?.id) {
        await squareClient.payments.complete({ paymentId: active.id });
        captured = true;
        // Burn any first-order discount now that the charge is real — the
        // payment route deferred this for delivery orders.
        await consumeOrderDiscounts(order).catch((e) =>
          console.error(
            "[driver/status] discount consume failed (non-fatal)",
            e,
          ),
        );
      } else if (activeStatus === "CAPTURED") {
        // Already accepted/charged → idempotent re-tap (fall through to record).
      } else if (hasAnyCardTender(order.tenders)) {
        // Card tender(s) exist but none is live — every attempt is FAILED/VOIDED
        // (declined / timed-out / cancelled). Can't take it.
        const deadStatus = order.tenders?.find(
          (t) => t.cardDetails?.status,
        )?.cardDetails?.status;
        return NextResponse.json(
          {
            ok: false,
            error: `cannot accept: authorization is ${deadStatus}`,
          },
          { status: 409 },
        );
      } else {
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
      scheduleLiveActivityPush(
        orderId,
        "accepted",
        auth.driver?.name ?? body.driverLabel ?? null,
      );
      return NextResponse.json({ ok: true, captured });
    }

    const nextState = ACTION_TO_STATE[action];

    // Version + fulfillment uid fed to the orders.update below. The $0-settle
    // branch may refresh these from a post-pay re-read (pay bumps the version,
    // so the pre-pay values would be guaranteed stale).
    let version = order.version;
    let uid = fulfillment.uid;

    // Square refuses to COMPLETE a fulfillment on an unpaid order. Normally the
    // card is captured at "accept", so by delivery the order is paid. But if an
    // order ever reaches delivery still only AUTHORIZED (e.g. its fulfillment was
    // advanced to PREPARED outside the accept flow), capture the held card now —
    // a delivered order must be paid — so "Mark delivered" never dead-ends with
    // an opaque "not paid for" error. Idempotent: only fires while AUTHORIZED.
    if (action === "delivered") {
      const active = pickActiveCardTender(order.tenders);
      if (active?.cardDetails?.status === "AUTHORIZED" && active.id) {
        await squareClient.payments.complete({ paymentId: active.id });
        // Burn any deferred first-order discount, mirroring the accept path.
        await consumeOrderDiscounts(order).catch((e) =>
          console.error("[driver/status] deliver-capture discount consume failed (non-fatal)", e),
        );
        // Capture bumps the order version; the retry loop below re-reads on the
        // resulting VERSION_MISMATCH, so no extra refresh is needed here.
      } else if (!active && !((order.totalMoney?.amount ?? 0n) > 0n)) {
        // $0 loyalty-comped delivery order (DE837): no card tender exists and
        // checkout deliberately did NOT settle it — orders.pay at checkout
        // would have COMPLETED the order + fulfillment before any driver
        // touched it (the DE833 regression), killing the accept → deliver
        // flow. Accept intentionally doesn't settle either (same reason: the
        // ride isn't over). So the order arrives here still OPEN with zero
        // tenders, and Square refuses to COMPLETE a fulfillment on an unpaid
        // order — without this branch the $0 order can never be marked
        // delivered and never lands on the Square books.
        //
        // Delivery is the moment the "sale" is final, so settle NOW via
        // orders.pay with an empty paymentIds list (Square accepts it because
        // the order total, 0, is satisfied by the sum of payments, 0 — same
        // trick as the $0 pickup branch in /api/payment).
        //
        // State guards: only an OPEN order gets paid. CANCELED → explicit 409
        // (a declined/swept order can't be "delivered"); COMPLETED (re-tap
        // after a successful settle) → no-op success.
        if (order.state === "CANCELED") {
          return NextResponse.json(
            { ok: false, error: "cannot deliver: order is canceled" },
            { status: 409 },
          );
        }

        let fulfillmentClosed = order.state !== "OPEN";

        if (order.state === "OPEN") {
          let lostSettleRace = false;
          try {
            await squareClient.orders.pay({
              orderId,
              idempotencyKey: randomUUID(),
              paymentIds: [],
            });
          } catch (err) {
            // Double-tap race: two "delivered" taps can BOTH read the order as
            // OPEN — orders.pay's effect is visible with a lag (see the $0
            // branch of /api/payment: "orders.pay succeeded ... still shows
            // state=OPEN"), so the state guard above can't catch the second
            // tap. The loser's pay reaches Square after the winner closed the
            // order and gets rejected — but that rejection MEANS the order is
            // settled, so treat it as success rather than bubbling a 502 at
            // the driver. Anything else (network, auth, …) still throws.
            // (Exact Square error text for paying a closed order isn't pinned
            // down in this repo, hence the broad match + warn with the raw
            // message so production logs can tighten it later.)
            const text = err instanceof Error ? err.message : String(err);
            const rejectedAsSettled =
              /ALREADY[_ ]?(COMPLETED|PAID)|INVALID[_ ]?ORDER[_ ]?STATE|NOT[_ ]?(IN[_ ]?STATE[_ ]?)?OPEN|COMPLETED/i.test(
                text,
              );
            if (!rejectedAsSettled) throw err;
            console.warn(
              "[driver/status] $0 orders.pay rejected — order already settled by a concurrent request, treating as delivered:",
              text,
            );
            lostSettleRace = true;
          }

          if (lostSettleRace) {
            // The winning request owns the fulfillment verification/backfill;
            // a second writer here would just collide with it.
            fulfillmentClosed = true;
          } else {
            // Verify orders.pay really closed the fulfillment. The repo's only
            // evidence of the auto-close (DE833) covers a PROPOSED fulfillment
            // at checkout; at delivery ours is PREPARED, and Square's behavior
            // for that isn't documented here. Re-read and check; if it's still
            // open, fall through to the normal orders.update below — the order
            // is paid now, so Square accepts COMPLETE. Feed the loop the fresh
            // version/uid (pay bumped the version; the stale one would burn a
            // retry on a guaranteed VERSION_MISMATCH).
            const fresh = (await squareClient.orders.get({ orderId })).order;
            const freshFulfillment = fresh?.fulfillments?.[0];
            fulfillmentClosed =
              !freshFulfillment || freshFulfillment.state === "COMPLETED";
            if (!fulfillmentClosed && fresh?.version != null && freshFulfillment?.uid) {
              version = fresh.version;
              uid = freshFulfillment.uid;
            }
          }
        }

        if (fulfillmentClosed) {
          await recordDispatch({
            orderId,
            orderNumber: order.referenceId ?? order.ticketName ?? null,
            status: action,
            driverLabel: body.driverLabel ?? null,
            driverId: auth.driverId ?? null,
          });
          scheduleLiveActivityPush(
            orderId,
            "delivered",
            auth.driver?.name ?? body.driverLabel ?? null,
          );

          return NextResponse.json({
            ok: true,
            fulfillmentState: "COMPLETED",
            settled: true,
          });
        }
        // Fulfillment still open after a successful pay → fall through to the
        // shared orders.update below to push it to COMPLETED.
      }
    }

    // Apply the fulfillment-state change with a version-conflict retry.
    // The order version can move between our get and update — e.g. staff
    // advancing the same ticket in Square POS, or Square's own background
    // settlement. On VERSION_MISMATCH we re-read the latest version + uid
    // and try again (the operation is idempotent: setting an already-set
    // state is a no-op).
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
    scheduleLiveActivityPush(
      orderId,
      action,
      auth.driver?.name ?? body.driverLabel ?? null,
    );

    return NextResponse.json({ ok: true, fulfillmentState: nextState });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[driver/status]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
