import { NextResponse } from "next/server";
import { squareClient } from "@/lib/square";
import { STORE_LAT, STORE_LNG } from "@/lib/constants";
import { getDispatchTracking } from "@/lib/driver-tokens";

// Customer-facing order status poll (every 5s from OrderStatusHero). Returns
// the Square fulfillment state and — for self-delivery orders that are out
// for delivery — the driver's latest GPS fix so the confirmation page can
// render a live map. The driver location lives on the delivery_dispatch row,
// updated by the driver app via POST /api/driver/location.

export const dynamic = "force-dynamic";

function num(v: string | undefined | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params;

  try {
    const response = await squareClient.orders.get({ orderId });
    const order = response.order;
    const fulfillment = order?.fulfillments?.[0];
    const state = fulfillment?.state ?? null;

    const isDelivery =
      order?.metadata?.fulfillment_type === "DELIVERY" ||
      fulfillment?.type === "DELIVERY";

    // Only assemble tracking once the order is out for delivery (PREPARED) —
    // before that there's no driver en route, and after COMPLETED the map is
    // moot. Reading the dispatch row is cheap (single-row Supabase lookup).
    let tracking = null;
    if (isDelivery && state === "PREPARED") {
      const dispatch = await getDispatchTracking(orderId).catch(() => null);
      tracking = {
        destLat: num(order?.metadata?.delivery_lat),
        destLng: num(order?.metadata?.delivery_lng),
        storeLat: STORE_LAT,
        storeLng: STORE_LNG,
        driverLat: dispatch?.driverLat ?? null,
        driverLng: dispatch?.driverLng ?? null,
        driverHeading: dispatch?.driverHeading ?? null,
        locationUpdatedAt: dispatch?.locationUpdatedAt ?? null,
      };
    }

    return NextResponse.json(
      { ok: true, state, tracking },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
