import { NextResponse } from "next/server";
import { squareClient, SQUARE_LOCATION_ID } from "@/lib/square";
import { backfillAccrualForOrder } from "@/lib/loyalty-backfill";
import { bearerTokenMatches } from "@/lib/bearer-auth";

export const dynamic = "force-dynamic";

// Window: old enough that Square's own check-in accrual has settled
// (>=10 min), young enough to stay timely (<=60 min). Cron runs every
// 15 min, so the 50-min span overlaps — the ledger dedups re-scans.
const MIN_AGE_MS = 10 * 60 * 1000;
const MAX_AGE_MS = 60 * 60 * 1000;

export async function GET(request: Request) {
  // Fail closed when CRON_SECRET is unset (e.g. preview deploy) so the public
  // internet can't trigger Square order scans. Constant-time compare.
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[cron/loyalty-backfill-sweep] CRON_SECRET not configured");
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  if (!bearerTokenMatches(request, expected)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const now = Date.now();
  const startAt = new Date(now - MAX_AGE_MS).toISOString();
  const endAt = new Date(now - MIN_AGE_MS).toISOString();

  let processed = 0;
  let accrued = 0;
  let cursor: string | undefined;
  try {
    do {
      const res = await squareClient.orders.search({
        locationIds: [SQUARE_LOCATION_ID],
        query: {
          filter: {
            dateTimeFilter: { createdAt: { startAt, endAt } },
            stateFilter: { states: ["COMPLETED", "OPEN"] },
          },
          sort: { sortField: "CREATED_AT", sortOrder: "DESC" },
        },
        limit: 500,
        cursor,
      });
      const orders = res.orders ?? [];
      for (const o of orders) {
        if (!o.id || !o.customerId) continue;
        processed++;
        const r = await backfillAccrualForOrder(o.id, "cron");
        if (r.status === "accrued") accrued++;
      }
      cursor = res.cursor;
    } while (cursor);
  } catch (e) {
    console.error("[loyalty-backfill-sweep] error", e);
    return NextResponse.json({ ok: false, processed, accrued }, { status: 500 });
  }

  console.log(`[loyalty-backfill-sweep] processed=${processed} accrued=${accrued}`);
  return NextResponse.json({ ok: true, processed, accrued });
}
