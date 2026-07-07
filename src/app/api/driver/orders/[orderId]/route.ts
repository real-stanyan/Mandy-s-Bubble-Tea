import { NextResponse } from "next/server";
import { SquareError } from "square";
import { squareClient } from "@/lib/square";
import { serializeSquareResponse } from "@/lib/utils";
import { authDriver } from "@/lib/driver-auth";
import {
  getDriverFixesForOrders,
  getAcceptedOrderIds,
} from "@/lib/driver-tokens";

// Driver app — fetch ONE delivery order by id.
//
// The queue endpoint (GET /api/driver/orders) reads via squareClient.orders.search,
// which is eventually consistent: a just-authorized order isn't indexed yet, so a
// fresh `new_delivery` push can land before the order shows up in the queue. This
// route reads the order directly with squareClient.orders.get — unaffected by the
// search index lag — so the driver app has a fetch-by-id fallback that always
// resolves the order.
//
// Unlike the queue, this does NOT filter to active fulfillment states: a by-id
// lookup must return the order regardless of state (incl. COMPLETED/CANCELED) so
// the client can render the correct terminal screen. The DELIVERY-type guard is
// still enforced.
//
// Auth: shared store password via Bearer (see src/lib/driver-auth.ts).

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const auth = await authDriver(request);
  if (!auth.ok) {
    if (auth.reason === "unconfigured") {
      console.error("[driver/orders/:id] no driver auth configured on server");
      return NextResponse.json({ ok: false }, { status: 500 });
    }
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { orderId } = await params;

  try {
    const response = await squareClient.orders.get({ orderId });
    const order = response.order;

    // Not found, or not a self-delivery order → 404. (A by-id lookup deliberately
    // does NOT filter on fulfillment state, so COMPLETED/CANCELED deliveries still
    // resolve — the client needs them to show the right terminal screen.)
    if (!order || order.metadata?.fulfillment_type !== "DELIVERY") {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    // Which of these a driver has already accepted (dispatch ledger). This is
    // the real "a driver took this job" signal and works for $0 loyalty orders
    // too — they have no card tender to infer acceptance from.
    const acceptedSet = await getAcceptedOrderIds(order.id ? [order.id] : []);

    const f = order.fulfillments?.[0];
    const lat = order.metadata?.delivery_lat;
    const lng = order.metadata?.delivery_lng;
    const projected = {
      id: order.id,
      // DE-prefixed ticket number staff and driver both see.
      orderNumber: order.referenceId ?? order.ticketName ?? null,
      createdAt: order.createdAt ?? null,
      fulfillmentUid: f?.uid ?? null,
      fulfillmentState: f?.state ?? null,
      // Has a driver taken this job? From the dispatch ledger, not payment,
      // so $0 loyalty orders still require acceptance. Past pickup implies
      // accepted. Drives "Accept" vs "Mark picked up" in the app.
      accepted:
        acceptedSet.has(order.id ?? "") ||
        f?.state === "PREPARED" ||
        f?.state === "COMPLETED",
      address: order.metadata?.delivery_address ?? null,
      lat: lat != null ? Number(lat) : null,
      lng: lng != null ? Number(lng) : null,
      // Customer display name for the order sheet (Prototype's customer card).
      customerName: f?.pickupDetails?.recipient?.displayName ?? null,
      // Customer phone for the call button.
      phone: f?.pickupDetails?.recipient?.phoneNumber ?? null,
      // Free-text note (driver instructions + order note), stamped with
      // the 🚚 marker. Useful for "leave at door" type instructions.
      note: f?.pickupDetails?.note ?? null,
      totalCents: order.totalMoney?.amount?.toString() ?? "0",
      // Per-order delivery fee (Square service charge uid "delivery-fee").
      // Absent on free-delivery orders → "0". Shown on the app detail screen.
      deliveryFeeCents:
        order.serviceCharges
          ?.find((sc) => sc.uid === "delivery-fee")
          ?.amountMoney?.amount?.toString() ?? "0",
      itemSummary: (order.lineItems ?? [])
        .map((li) => `${li.quantity}× ${li.name ?? "Item"}`)
        .join(", "),
    };

    // Admin (read-only manager) also sees the driver's live GPS. Driver responses
    // keep the original shape — installed builds unaffected.
    let payload: object = projected;
    if (auth.role === "admin") {
      const fixes = await getDriverFixesForOrders(order.id ? [order.id] : []);
      payload = {
        ...projected,
        driver: (order.id && fixes[order.id]) || null,
      };
    }

    return NextResponse.json(
      { ok: true, role: auth.role, order: serializeSquareResponse(payload) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    // Square throws (not returns null) when the order id doesn't exist — map
    // that to 404 so a genuinely-missing order reads as "not found", not a
    // server error. Every other failure stays a 502.
    if (error instanceof SquareError && error.statusCode === 404) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error("[driver/orders/:id]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
