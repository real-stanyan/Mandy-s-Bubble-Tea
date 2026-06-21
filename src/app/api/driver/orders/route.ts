import { NextResponse } from "next/server";
import { squareClient, SQUARE_LOCATION_ID } from "@/lib/square";
import { serializeSquareResponse } from "@/lib/utils";
import { authDriver } from "@/lib/driver-auth";
import {
  getDriverFixesForOrders,
  getAcceptedOrderIds,
} from "@/lib/driver-tokens";

// Driver app — the active delivery queue.
//
// Self-delivery orders are created as PICKUP fulfillments stamped with
// metadata.fulfillment_type=DELIVERY (Square hides true DELIVERY-type orders
// from API callers without a partnership — see src/lib/delivery-ticket.ts).
// The driver address + coords + phone all live on the Square order, so this
// route reads straight from Square — there is no Supabase orders table.
//
// Auth: shared store password via Bearer (see src/lib/driver-auth.ts).

export const dynamic = "force-dynamic";

// Fulfillment states that mean "still needs driving". COMPLETED = delivered,
// CANCELED = scrubbed; both drop out of the active queue.
const ACTIVE_FULFILLMENT_STATES = new Set(["PROPOSED", "RESERVED", "PREPARED"]);

export async function GET(request: Request) {
  const auth = await authDriver(request);
  if (!auth.ok) {
    if (auth.reason === "unconfigured") {
      console.error("[driver/orders] no driver auth configured on server");
      return NextResponse.json({ ok: false }, { status: 500 });
    }
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!SQUARE_LOCATION_ID) {
    return NextResponse.json(
      { ok: false, error: "SQUARE_LOCATION_ID is not set on the server" },
      { status: 500 },
    );
  }

  try {
    const response = await squareClient.orders.search({
      locationIds: [SQUARE_LOCATION_ID],
      limit: 100,
      query: {
        filter: {
          // Only in-progress orders. A delivered order's order.state stays
          // OPEN until staff close it, so we additionally drop COMPLETED
          // fulfillments below.
          stateFilter: { states: ["OPEN"] },
        },
        // Newest first so a just-placed order is always in the window
        // (a stale ASC+limit page would return the 100 oldest OPEN orders
        // and miss fresh ones). We re-sort the filtered deliveries to
        // oldest-first below for the driver's FIFO queue.
        sort: { sortField: "CREATED_AT", sortOrder: "DESC" },
      },
    });

    const all = response.orders ?? [];

    const candidates = all
      .filter((o) => o.metadata?.fulfillment_type === "DELIVERY")
      // Show orders that are either paid (netAmountDue===0 — card-captured,
      // full/partial loyalty $0) OR holding an authorization awaiting a driver.
      // Mandy Delivery authorizes the card at checkout and captures only when a
      // driver accepts, so a not-yet-accepted order has due>0 but an AUTHORIZED
      // card tender — it must still surface so a driver can accept it.
      // Abandoned carts (no tender, due>0) stay excluded.
      .filter((o) => {
        const total = o.totalMoney?.amount ?? 0n;
        const due = o.netAmountDueMoney?.amount ?? total;
        const held =
          o.tenders?.some((t) => t.cardDetails?.status === "AUTHORIZED") ??
          false;
        return due === 0n || held;
      })
      .filter((o) => {
        const state = o.fulfillments?.[0]?.state ?? "PROPOSED";
        return ACTIVE_FULFILLMENT_STATES.has(state);
      });

    // Which of these a driver has already accepted (dispatch ledger). This is
    // the real "a driver took this job" signal and works for $0 loyalty orders
    // too — they have no card tender to infer acceptance from.
    const acceptedSet = await getAcceptedOrderIds(
      candidates.map((o) => o.id).filter((id): id is string => !!id),
    );

    const deliveries = candidates
      .map((order) => {
        const f = order.fulfillments?.[0];
        const lat = order.metadata?.delivery_lat;
        const lng = order.metadata?.delivery_lng;
        return {
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
      })
      // Oldest first — the driver works the queue front-to-back.
      .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));

    // Admin (read-only manager) also sees the driver's live GPS per order.
    // Driver responses keep the original shape — installed builds unaffected.
    let payload: object[] = deliveries;
    if (auth.role === "admin") {
      const ids = deliveries.map((o) => o.id).filter((id): id is string => !!id);
      const fixes = await getDriverFixesForOrders(ids);
      payload = deliveries.map((o) => ({
        ...o,
        driver: (o.id && fixes[o.id]) || null,
      }));
    }

    return NextResponse.json(
      { ok: true, role: auth.role, orders: serializeSquareResponse(payload) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[driver/orders]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
