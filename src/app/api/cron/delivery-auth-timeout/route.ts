import { NextResponse } from "next/server";
import { squareClient, SQUARE_LOCATION_ID } from "@/lib/square";
import { bearerTokenMatches } from "@/lib/bearer-auth";
import { getAcceptedOrderIds } from "@/lib/driver-tokens";
import { releaseDeliveryOrder } from "@/lib/release-delivery-order";

const ACTIVE_FULFILLMENT_STATES = new Set(["PROPOSED", "RESERVED"]);

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

      // Unaccepted, still-active delivery orders in this page. Acceptance is the
      // dispatch ledger (works for $0 loyalty orders too), so we drop anything a
      // driver has already taken.
      const candidates = (res.orders ?? []).filter(
        (o) =>
          o.metadata?.fulfillment_type === "DELIVERY" &&
          o.id &&
          ACTIVE_FULFILLMENT_STATES.has(o.fulfillments?.[0]?.state ?? "PROPOSED"),
      );
      const acceptedSet = await getAcceptedOrderIds(
        candidates.map((o) => o.id).filter((id): id is string => !!id),
      );

      for (const order of candidates) {
        if (acceptedSet.has(order.id!)) continue; // a driver took it

        const tender = order.tenders?.find((t) => t.cardDetails?.status);
        const tenderStatus = tender?.cardDetails?.status;
        // CAPTURED implies accepted (capture happens on accept) — leave it.
        // AUTHORIZED → paid hold to release. Undefined → $0 loyalty order, just
        // cancel. VOIDED → a prior sweep already handled it.
        if (tenderStatus === "CAPTURED" || tenderStatus === "VOIDED") continue;

        scanned += 1;
        try {
          // Same release an explicit driver "Decline" performs — return spent
          // stars, void the held authorization ($0 orders have none), cancel the
          // fulfillment. The customer must not lose money or stars on an order
          // no driver took.
          const { returned, voided } = await releaseDeliveryOrder(order);
          cancelled += 1;
          console.log(
            `[cron/delivery-auth-timeout] cancelled ${order.referenceId ?? order.id}${
              voided ? " (voided hold)" : " ($0)"
            }${returned > 0 ? ` (returned ${returned} reward${returned > 1 ? "s" : ""})` : ""}`,
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
