import { NextResponse } from "next/server";
import { authDriver } from "@/lib/driver-auth";
import { getDeliveredDispatchForDriver } from "@/lib/driver-shifts";
import { hydrateOrders } from "@/lib/order-hydrate";
import { brisbaneYmd, brisbaneClock, brisbaneWeekday } from "@/lib/brisbane-date";

// Driver History — this driver's completed deliveries, grouped by Brisbane day,
// plus a rolling 7-day summary (count / earned / avg time). Delivered orders
// fall out of Square's OPEN search, so we read them back from the dispatch
// ledger (the authoritative "this driver delivered it" record) and hydrate the
// address/items/fee from Square by id.

export const dynamic = "force-dynamic";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export async function GET(request: Request) {
  const auth = await authDriver(request);
  if (!auth.ok) {
    if (auth.reason === "unconfigured") return NextResponse.json({ ok: false }, { status: 500 });
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // History is a driver's own record. The manager (no driverId) and legacy
  // shared-token sessions have nothing to attribute — return an empty record.
  if (!auth.driverId) {
    return NextResponse.json(
      { ok: true, week: { deliveries: 0, earnedCents: 0, avgMinutes: 0 }, groups: [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const delivered = await getDeliveredDispatchForDriver(auth.driverId);
    const hydrated = await hydrateOrders(delivered.map((d) => d.orderId));

    const now = new Date();
    const todayYmd = brisbaneYmd(now);
    const yesterdayYmd = brisbaneYmd(new Date(now.getTime() - 24 * 60 * 60 * 1000));

    // Per-delivery rows + rolling-week accumulators.
    let weekCount = 0;
    let weekEarned = 0;
    let weekMinutesSum = 0;
    let weekMinutesN = 0;

    const groupsByYmd = new Map<
      string,
      { label: string; ymd: string; rows: object[]; count: number }
    >();

    for (const d of delivered) {
      if (!d.deliveredAt) continue;
      const h = hydrated[d.orderId];
      const ymd = brisbaneYmd(new Date(d.deliveredAt));
      const feeCents = h?.deliveryFeeCents ?? 0;

      // Rolling 7-day summary.
      if (now.getTime() - new Date(d.deliveredAt).getTime() <= WEEK_MS) {
        weekCount += 1;
        weekEarned += feeCents;
        if (d.acceptedAt) {
          const mins = (new Date(d.deliveredAt).getTime() - new Date(d.acceptedAt).getTime()) / 60000;
          if (mins > 0 && mins < 600) {
            weekMinutesSum += mins;
            weekMinutesN += 1;
          }
        }
      }

      const label =
        ymd === todayYmd ? "Today" : ymd === yesterdayYmd ? "Yesterday" : brisbaneWeekday(d.deliveredAt);
      let g = groupsByYmd.get(ymd);
      if (!g) {
        g = { label, ymd, rows: [], count: 0 };
        groupsByYmd.set(ymd, g);
      }
      g.rows.push({
        orderId: d.orderId,
        orderNumber: d.orderNumber ?? h?.orderNumber ?? null,
        address: h?.address ?? null,
        itemSummary: h?.itemSummary ?? "",
        feeCents,
        timeLabel: brisbaneClock(d.deliveredAt),
        delivered: true,
      });
      g.count += 1;
    }

    // Newest day first (ymd sorts lexicographically).
    const groups = [...groupsByYmd.values()].sort((a, b) => b.ymd.localeCompare(a.ymd));

    return NextResponse.json(
      {
        ok: true,
        week: {
          deliveries: weekCount,
          earnedCents: weekEarned,
          avgMinutes: weekMinutesN ? Math.round(weekMinutesSum / weekMinutesN) : 0,
        },
        groups,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[driver/history]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
