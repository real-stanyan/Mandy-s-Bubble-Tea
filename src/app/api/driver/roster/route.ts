import { NextResponse } from "next/server";
import { squareClient, SQUARE_LOCATION_ID } from "@/lib/square";
import { serializeSquareResponse } from "@/lib/utils";
import { authDriver } from "@/lib/driver-auth";
import {
  getDispatchRowsForOrders,
  getDriversByIds,
  type DriverFix,
} from "@/lib/driver-tokens";

// Manager Live-Operations roster — every active delivery that a driver is
// currently working, grouped with the driver's name + live GPS. Read-only and
// admin-only: the manager (admin role) watches; drivers act.
//
// Mirrors /api/driver/orders' Square read (there is no Supabase orders table —
// deliveries live on Square as PICKUP fulfillments tagged DELIVERY), then joins
// the dispatch ledger for who-took-it + their latest GPS fix.

export const dynamic = "force-dynamic";

const ACTIVE_FULFILLMENT_STATES = new Set(["PROPOSED", "RESERVED", "PREPARED"]);

// A GPS fix older than this reads as "paused" (driver app backgrounded / signal
// lost). The app pushes a fix ~every 10s while delivering, so 120s is ~12 missed.
const GPS_STALE_MS = 120_000;

type RosterStatus = "store" | "enroute" | "paused";

export async function GET(request: Request) {
  const auth = await authDriver(request);
  if (!auth.ok) {
    if (auth.reason === "unconfigured") {
      console.error("[driver/roster] no driver auth configured on server");
      return NextResponse.json({ ok: false }, { status: 500 });
    }
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  // Roster is a manager-only view. Drivers get 403 (they use /api/driver/orders).
  if (auth.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
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
        filter: { stateFilter: { states: ["OPEN"] } },
        sort: { sortField: "CREATED_AT", sortOrder: "DESC" },
      },
    });

    const all = response.orders ?? [];
    const candidates = all
      .filter((o) => o.metadata?.fulfillment_type === "DELIVERY")
      .filter((o) => {
        const total = o.totalMoney?.amount ?? 0n;
        const due = o.netAmountDueMoney?.amount ?? total;
        const held =
          o.tenders?.some((t) => t.cardDetails?.status === "AUTHORIZED") ?? false;
        return due === 0n || held;
      })
      .filter((o) =>
        ACTIVE_FULFILLMENT_STATES.has(o.fulfillments?.[0]?.state ?? "PROPOSED"),
      );

    const ids = candidates.map((o) => o.id).filter((id): id is string => !!id);
    const dispatch = await getDispatchRowsForOrders(ids);

    // Only deliveries a driver has actually taken belong on the live roster —
    // an unaccepted PROPOSED order has no driver to show. driver_id resolves
    // the owning driver's profile; legacy shared-token orders fall back to the
    // dispatch driver_label, then "Staff".
    const driverIds = Object.values(dispatch)
      .map((d) => d.driverId)
      .filter((x): x is string => !!x);
    const driversById = await getDriversByIds(driverIds);

    // A driver has one physical location, but GPS is posted per-order (against
    // the order being actively driven). Attribute each driver's freshest fix —
    // across all their active orders — to every one of their deliveries, so a
    // second accepted order isn't "no fix" just because tracking runs on the
    // order currently out for delivery.
    const latestFixByDriver: Record<string, DriverFix> = {};
    for (const dd of Object.values(dispatch)) {
      if (!dd.driverId || !dd.fix?.updatedAt) continue;
      const prev = latestFixByDriver[dd.driverId];
      if (!prev || new Date(dd.fix.updatedAt) > new Date(prev.updatedAt ?? 0)) {
        latestFixByDriver[dd.driverId] = dd.fix;
      }
    }

    const now = Date.now();
    const deliveries = candidates
      .map((order) => {
        const id = order.id ?? "";
        const d = dispatch[id];
        // Not taken by a driver yet → not on the live-ops roster.
        if (!d || d.status === "pending") return null;

        const f = order.fulfillments?.[0];
        const pickedUp =
          d.status === "picked_up" ||
          d.status === "delivered" ||
          f?.state === "PREPARED" ||
          f?.state === "COMPLETED";

        // The driver's current position (their freshest fix across orders),
        // falling back to this order's own fix for legacy null-driver rows.
        const fix = (d.driverId && latestFixByDriver[d.driverId]) || d.fix;
        const ageMs = fix?.updatedAt
          ? now - new Date(fix.updatedAt).getTime()
          : Infinity;
        const gpsFresh = !!fix && ageMs <= GPS_STALE_MS;

        // Status is the delivery stage, not a GPS readout. An accepted order
        // still at the store ("not picked up") is "At store" regardless of GPS —
        // the driver isn't expected to be sharing a live track before pickup.
        // "GPS paused" only applies once out for delivery and the fix goes stale.
        const status: RosterStatus = !pickedUp
          ? "store"
          : gpsFresh
            ? "enroute"
            : "paused";

        const driver = d.driverId ? driversById[d.driverId] : undefined;
        const driverName = driver?.name ?? d.driverLabel ?? "Staff";
        const driverInitial = (driverName.trim()[0] ?? "?").toUpperCase();

        const lat = order.metadata?.delivery_lat;
        const lng = order.metadata?.delivery_lng;

        return {
          orderId: id,
          orderNumber: order.referenceId ?? order.ticketName ?? null,
          customerName: f?.pickupDetails?.recipient?.displayName ?? null,
          itemSummary: (order.lineItems ?? [])
            .map((li) => `${li.quantity}× ${li.name ?? "Item"}`)
            .join(", "),
          address: order.metadata?.delivery_address ?? null,
          destLat: lat != null ? Number(lat) : null,
          destLng: lng != null ? Number(lng) : null,
          driverId: d.driverId,
          driverName,
          driverInitial,
          status,
          gps: fix, // { lat, lng, heading, updatedAt } | null
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);

    // Distinct drivers currently out on an active delivery (the header's "N LIVE").
    const liveDrivers = new Set(
      deliveries.map((x) => x.driverId ?? x.driverName),
    ).size;

    return NextResponse.json(
      {
        ok: true,
        role: auth.role,
        liveDrivers,
        deliveries: serializeSquareResponse(deliveries),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[driver/roster]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
