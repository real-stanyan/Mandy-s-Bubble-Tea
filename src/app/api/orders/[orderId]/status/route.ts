import { NextResponse } from "next/server";
import { squareClient } from "@/lib/square";
import { getAuthedUser } from "@/lib/auth";
import { ownsOrder } from "@/lib/order-complaint";
import { isStickerHeld } from "@/lib/print-jobs";
import { STORE_LAT, STORE_LNG } from "@/lib/constants";
import {
  getDispatchTracking,
  getRouteCache,
  saveRouteCache,
  type DispatchStatus,
} from "@/lib/driver-tokens";
import {
  decodePolyline,
  fetchDirectionsRoute,
  shouldRefetchRoute,
} from "@/lib/delivery-route";

// Customer-facing order status poll (every 5s from OrderStatusHero). Returns
// the Square fulfillment state and — for self-delivery orders that are out
// for delivery — the driver's latest GPS fix so the confirmation page can
// render a live map. The driver location lives on the delivery_dispatch row,
// updated by the driver app via POST /api/driver/location.
//
// When the driver has a GPS fix we also decorate the payload with a driving
// route (polyline points) + ETA from Google Directions, cached on the dispatch
// row so the 5s poll doesn't hammer a paid API (see delivery-route.ts).

export const dynamic = "force-dynamic";

function num(v: string | undefined | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Resolve the driving route driver→destination through the dispatch-row
// cache. Any failure (no key, Google error, DB error) degrades to null —
// the map renders without a route line and the sheet falls back to the
// static ETA copy.
async function resolveRoute(
  orderId: string,
  origin: { lat: number; lng: number },
  dest: { lat: number; lng: number },
): Promise<{ route: [number, number][]; etaSeconds: number | null } | null> {
  const key = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;
  if (!key) return null;
  try {
    const cache = await getRouteCache(orderId);
    if (!shouldRefetchRoute(cache, origin, new Date())) {
      return {
        route: decodePolyline(cache!.polyline!),
        etaSeconds: cache!.durationSecs,
      };
    }
    const fresh = await fetchDirectionsRoute(origin, dest, key);
    if (!fresh) {
      // Google refused — serve the stale cache if one exists rather than
      // flashing the route away mid-delivery.
      if (cache?.polyline) {
        return { route: decodePolyline(cache.polyline), etaSeconds: cache.durationSecs };
      }
      return null;
    }
    await saveRouteCache({
      orderId,
      polyline: fresh.polyline,
      originLat: origin.lat,
      originLng: origin.lng,
      durationSecs: fresh.durationSecs,
    }).catch(() => undefined); // cache write failure must not break the poll
    return { route: decodePolyline(fresh.polyline), etaSeconds: fresh.durationSecs };
  } catch (error) {
    console.error(
      "[orders/status] route resolve failed:",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

export async function GET(
  request: Request,
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

    // For delivery orders we read the dispatch row once: its plain status string
    // (pending → accepted → picked_up → delivered) drives the customer's
    // progress stepper and is NOT PII, so it's returned to everyone (like the
    // fulfillment `state`). The driver's GPS fix on the same row IS PII and stays
    // owner-gated below.
    let dispatchStatus: DispatchStatus | null = null;
    let dispatch: Awaited<ReturnType<typeof getDispatchTracking>> = null;
    if (isDelivery) {
      dispatch = await getDispatchTracking(orderId).catch(() => null);
      dispatchStatus = dispatch?.status ?? null;
    }

    // Tracking carries PII — the customer's home coordinates + the driver's
    // live GPS fix — so it is ONLY returned to the authenticated order owner.
    // The basic fulfillment `state` stays public so the confirmation page poll
    // keeps working; the live map is gated. (Order ids are opaque, but there
    // was previously zero ownership check on this PII.)
    let tracking = null;
    if (isDelivery && state === "PREPARED") {
      const user = await getAuthedUser(request);
      const isOwner = ownsOrder(
        user?.profile?.square_customer_id ?? null,
        order?.customerId ?? null,
      );
      if (isOwner) {
        const destLat = num(order?.metadata?.delivery_lat);
        const destLng = num(order?.metadata?.delivery_lng);
        const driverLat = dispatch?.driverLat ?? null;
        const driverLng = dispatch?.driverLng ?? null;

        // Route only once the driver is actually moving (has a GPS fix) —
        // before that a store→dest route would just restyle the map.
        let routeInfo: { route: [number, number][]; etaSeconds: number | null } | null =
          null;
        if (driverLat != null && driverLng != null && destLat != null && destLng != null) {
          routeInfo = await resolveRoute(
            orderId,
            { lat: driverLat, lng: driverLng },
            { lat: destLat, lng: destLng },
          );
        }

        tracking = {
          destLat,
          destLng,
          storeLat: STORE_LAT,
          storeLng: STORE_LNG,
          driverLat,
          driverLng,
          driverHeading: dispatch?.driverHeading ?? null,
          locationUpdatedAt: dispatch?.locationUpdatedAt ?? null,
          route: routeInfo?.route ?? null,
          etaSeconds: routeInfo?.etaSeconds ?? null,
        };
      }
    }

    // Scheduled pickup: is the cup sticker still held? While it is, nobody
    // is making the drinks, and the stepper must say "Received", not
    // "Preparing" (Stan, 2026-08-17). Only worth a lookup for a pickup
    // order that isn't done yet.
    let held = false;
    if (!isDelivery && state !== "COMPLETED" && state !== "PREPARED") {
      held =
        fulfillment?.pickupDetails?.scheduleType === "SCHEDULED"
          ? await isStickerHeld(orderId)
          : false;
    }

    return NextResponse.json(
      { ok: true, state, dispatchStatus, tracking, held },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
