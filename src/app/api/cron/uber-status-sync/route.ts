import { NextResponse } from "next/server";
import { squareClient, SQUARE_LOCATION_ID } from "@/lib/square";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Runs every 5 minutes via Vercel Cron. Pulls Uber Direct status for
// delivery orders still in non-terminal Square fulfillment states and
// reconciles. Defense-in-depth against dropped webhooks.
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // Find recent delivery orders. Six-hour window covers the longest
  // realistic dispatch + pickup + dropoff cycle while keeping the
  // result set small.
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const search = await squareClient.orders.search({
    locationIds: [SQUARE_LOCATION_ID ?? ""],
    query: {
      filter: {
        dateTimeFilter: { createdAt: { startAt: since } },
        stateFilter: { states: ["OPEN", "COMPLETED", "CANCELED"] },
      },
    },
  });

  const inFlight = (search.orders ?? []).filter((o) => {
    const f = o.fulfillments?.[0];
    return (
      f?.type === "DELIVERY" &&
      o.metadata?.uber_delivery_id &&
      f.state !== "COMPLETED" &&
      f.state !== "CANCELED"
    );
  });

  const synced = 0;
  // Fetch each Uber delivery and sync state — implement once Phase 4
  // real client lookups are stable. Stubbed loop here to avoid hitting
  // Uber from cron until verified manually first.
  // TODO Phase 5b: call uber-direct getDelivery + reconcile.
  return NextResponse.json({ ok: true, candidates: inFlight.length, synced });
}
