import { NextResponse } from "next/server";
import { squareClient, SQUARE_LOCATION_ID } from "@/lib/square";
import { bearerTokenMatches } from "@/lib/bearer-auth";
import { getAcceptedOrderIds } from "@/lib/driver-tokens";
import { releaseDeliveryOrder } from "@/lib/release-delivery-order";
import { nagDriversUnacceptedDelivery } from "@/lib/driver-notify";
import { isUnpaidCheckout } from "@/lib/orders/ghost-zero-order";

const ACTIVE_FULFILLMENT_STATES = new Set(["PROPOSED", "RESERVED"]);

export const dynamic = "force-dynamic";

// Mandy Delivery unaccepted sweep: nag, then release.
//
// A delivery order holds (authorizes) the customer's card at checkout and is
// only charged when a driver accepts (which captures the hold). Two phases,
// one sweep, now running every minute:
//
//   • 5–30 min unaccepted → push a reminder to every driver device on every
//     tick, until someone accepts. Before this existed, the single new-order
//     popup was the only signal: miss it once (Jorja's 10pm order,
//     2026-08-09) and the order sat silently until the 30-minute release —
//     the customer saw "Cancelled", the shop saw nothing at all.
//   • ≥30 min unaccepted → release the customer: void the authorization,
//     return spent stars, cancel the fulfillment.
//
// "Not accepted" == the card tender is still AUTHORIZED (accept would have
// CAPTURED it; a prior sweep would have VOIDED it). We scan from 5 min ago
// back to ~6 days (Square auto-voids authorizations after ~6 days anyway), so
// already-voided / captured orders are simply skipped.
const NAG_MIN_AGE_MS = 5 * 60 * 1000; // grace before the first reminder
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
  // Window opens at the NAG threshold, not the cancel threshold — the sweep
  // now sees 5–30 min orders too, and branches on age below.
  const endAt = new Date(now - NAG_MIN_AGE_MS).toISOString();

  let scanned = 0;
  let cancelled = 0;
  let nagged = 0;
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

        // Never-paid checkout: the customer opened the pay sheet and walked
        // away (or every charge failed). No money is held, nothing to
        // release, nothing for a driver to deliver — not a "$0 loyalty
        // order". DE888 (2026-09-06): it drew 25 minutes of ⏰ pushes to every
        // driver and was then CANCELED, which poisoned the customer's
        // idempotent retry (Square replayed the CANCELED order; every later
        // Pay tap failed at the card). Leave it alone.
        if (isUnpaidCheckout(order)) continue;

        const tender = order.tenders?.find((t) => t.cardDetails?.status);
        const tenderStatus = tender?.cardDetails?.status;
        // CAPTURED implies accepted (capture happens on accept) — leave it.
        // AUTHORIZED → paid hold to release. Undefined → $0 loyalty order, just
        // cancel. VOIDED → a prior sweep already handled it.
        if (tenderStatus === "CAPTURED" || tenderStatus === "VOIDED") continue;

        // Age decides the phase. A missing createdAt can't happen for a real
        // Square order; treat it as past the cancel threshold so the old
        // release behaviour (and its tests) hold.
        const createdMs = order.createdAt ? Date.parse(order.createdAt) : 0;
        const ageMs = Number.isFinite(createdMs) && createdMs > 0 ? now - createdMs : MIN_AGE_MS;
        if (ageMs < MIN_AGE_MS) {
          // Nag phase: remind every driver device, every tick, until someone
          // accepts. Repetition is the feature — no ledger, no dedupe.
          try {
            await nagDriversUnacceptedDelivery(
              order,
              Math.floor(ageMs / 60_000),
              Math.max(1, Math.ceil((MIN_AGE_MS - ageMs) / 60_000)),
            );
            nagged += 1;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`nag ${order.referenceId ?? order.id}: ${msg}`);
            console.error(
              `[cron/delivery-auth-timeout] nag ${order.referenceId ?? order.id} failed: ${msg}`,
            );
          }
          continue;
        }

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

    return NextResponse.json({ ok: true, scanned, cancelled, nagged, errors });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[cron/delivery-auth-timeout]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
