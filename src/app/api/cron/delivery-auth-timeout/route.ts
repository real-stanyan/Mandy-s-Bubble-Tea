import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { squareClient, SQUARE_LOCATION_ID } from "@/lib/square";
import { bearerTokenMatches } from "@/lib/bearer-auth";

export const dynamic = "force-dynamic";

// Mandy Delivery auto-cancel sweep.
//
// A delivery order holds (authorizes) the customer's card at checkout and is
// only charged when a driver accepts (which captures the hold). If no driver
// accepts within 30 minutes, release the customer: void the authorization and
// cancel the order's fulfillment so it drops out of the active queue.
//
// "Not accepted" == the card tender is still AUTHORIZED (accept would have
// CAPTURED it; a prior sweep would have VOIDED it). We scan from 30 min ago
// back to ~6 days (Square auto-voids authorizations after ~6 days anyway), so
// already-voided / captured orders are simply skipped.
const MIN_AGE_MS = 30 * 60 * 1000; // grace period before auto-cancel
const MAX_AGE_MS = 6 * 24 * 60 * 60 * 1000; // Square auth lifetime ceiling

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[cron/delivery-auth-timeout] CRON_SECRET not configured");
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  if (!bearerTokenMatches(request, expected)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const now = Date.now();
  const startAt = new Date(now - MAX_AGE_MS).toISOString();
  const endAt = new Date(now - MIN_AGE_MS).toISOString();

  let scanned = 0;
  let cancelled = 0;
  const errors: string[] = [];
  let cursor: string | undefined;

  try {
    do {
      const res = await squareClient.orders.search({
        locationIds: [SQUARE_LOCATION_ID],
        cursor,
        query: {
          filter: {
            dateTimeFilter: { createdAt: { startAt, endAt } },
            stateFilter: { states: ["OPEN"] },
          },
          sort: { sortField: "CREATED_AT", sortOrder: "ASC" },
        },
      });
      cursor = res.cursor;

      for (const order of res.orders ?? []) {
        const isDelivery = order.metadata?.fulfillment_type === "DELIVERY";
        if (!isDelivery || !order.id) continue;

        // Only the authorized-but-not-accepted ones. CAPTURED = accepted,
        // VOIDED = a previous sweep already handled it.
        const tender = order.tenders?.find((t) => t.cardDetails?.status);
        if (tender?.cardDetails?.status !== "AUTHORIZED" || !tender.id) continue;

        scanned += 1;
        try {
          // Release the hold first, then cancel the fulfillment. If the void
          // succeeds but the cancel fails, the next sweep skips the now-VOIDED
          // tender — the customer is already released, which is what matters.
          await squareClient.payments.cancel({ paymentId: tender.id });

          const fulfillment = order.fulfillments?.[0];
          if (fulfillment?.uid && order.version != null) {
            await squareClient.orders.update({
              orderId: order.id,
              order: {
                locationId: SQUARE_LOCATION_ID,
                version: order.version,
                fulfillments: [{ uid: fulfillment.uid, state: "CANCELED" }],
              },
              idempotencyKey: randomUUID(),
            });
          }
          cancelled += 1;
          console.log(
            `[cron/delivery-auth-timeout] voided + cancelled ${order.referenceId ?? order.id}`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`${order.referenceId ?? order.id}: ${msg}`);
          console.error(
            `[cron/delivery-auth-timeout] ${order.referenceId ?? order.id} failed: ${msg}`,
          );
        }
      }
    } while (cursor);

    return NextResponse.json({ ok: true, scanned, cancelled, errors });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[cron/delivery-auth-timeout]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
