import { NextResponse } from "next/server";
import { authDriver } from "@/lib/driver-auth";
import {
  getOpenShift,
  startShift,
  endShift,
  setLocationMode,
  updateDriverPrefs,
  getDeliveredDispatchForDriver,
  type LocationMode,
} from "@/lib/driver-shifts";
import { hydrateOrders } from "@/lib/order-hydrate";
import { isBrisbaneToday } from "@/lib/brisbane-date";

// Driver Shift — clock on/off, today's stats, location-sharing mode, profile and
// preferences. GET returns the whole screen's state; POST mutates one slice.

export const dynamic = "force-dynamic";

type ShiftPrefs = { alertsEnabled: boolean; autoAccept: boolean; navApp: string };

function readPrefs(raw: Record<string, unknown> | undefined): ShiftPrefs {
  return {
    alertsEnabled: raw?.alertsEnabled !== false, // default on
    autoAccept: raw?.autoAccept === true, // default off
    navApp: typeof raw?.navApp === "string" ? (raw.navApp as string) : "apple_maps",
  };
}

async function buildState(driverId: string, driver: {
  name: string; suburb: string | null; phone: string | null; vehicle: string | null;
  joinedAt: string | null; rating: number | null; prefs: Record<string, unknown>;
}) {
  const open = await getOpenShift(driverId);

  // Today's deliveries (count + earned) from the dispatch ledger, hydrated for
  // the delivery fee.
  const delivered = await getDeliveredDispatchForDriver(driverId);
  const today = delivered.filter((d) => isBrisbaneToday(d.deliveredAt));
  const hydrated = await hydrateOrders(today.map((d) => d.orderId));
  const earnedCents = today.reduce(
    (sum, d) => sum + (hydrated[d.orderId]?.deliveryFeeCents ?? 0),
    0,
  );
  const onlineSecs = open
    ? Math.max(0, Math.round((Date.now() - new Date(open.startedAt).getTime()) / 1000))
    : 0;

  return {
    ok: true,
    onShift: !!open,
    startedAt: open?.startedAt ?? null,
    locationMode: open?.locationMode ?? "while",
    today: { deliveries: today.length, earnedCents, onlineSecs },
    profile: {
      name: driver.name,
      initial: (driver.name.trim()[0] ?? "?").toUpperCase(),
      suburb: driver.suburb,
      phone: driver.phone,
      vehicle: driver.vehicle,
      joinedAt: driver.joinedAt,
      rating: driver.rating,
    },
    prefs: readPrefs(driver.prefs),
  };
}

export async function GET(request: Request) {
  const auth = await authDriver(request);
  if (!auth.ok) {
    if (auth.reason === "unconfigured") return NextResponse.json({ ok: false }, { status: 500 });
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!auth.driverId || !auth.driver) {
    return NextResponse.json(
      { ok: false, error: "Shift requires a per-driver code" },
      { status: 403 },
    );
  }
  try {
    return NextResponse.json(await buildState(auth.driverId, auth.driver), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[driver/shift GET]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const auth = await authDriver(request);
  if (!auth.ok) {
    if (auth.reason === "unconfigured") return NextResponse.json({ ok: false }, { status: 500 });
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!auth.driverId || !auth.driver) {
    return NextResponse.json({ ok: false, error: "Shift requires a per-driver code" }, { status: 403 });
  }

  let body: {
    action?: string;
    locationMode?: LocationMode;
    prefs?: Record<string, unknown>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad body" }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "start":
        await startShift(auth.driverId, body.locationMode === "always" ? "always" : "while");
        break;
      case "end":
        await endShift(auth.driverId);
        break;
      case "set_location_mode":
        if (body.locationMode !== "while" && body.locationMode !== "always") {
          return NextResponse.json({ ok: false, error: "Bad locationMode" }, { status: 400 });
        }
        await setLocationMode(auth.driverId, body.locationMode);
        break;
      case "set_prefs": {
        if (!body.prefs || typeof body.prefs !== "object") {
          return NextResponse.json({ ok: false, error: "Bad prefs" }, { status: 400 });
        }
        const patch: Record<string, unknown> = {};
        if (typeof body.prefs.alertsEnabled === "boolean") patch.alertsEnabled = body.prefs.alertsEnabled;
        if (typeof body.prefs.autoAccept === "boolean") patch.autoAccept = body.prefs.autoAccept;
        if (typeof body.prefs.navApp === "string") patch.navApp = body.prefs.navApp;
        const merged = await updateDriverPrefs(auth.driverId, patch);
        auth.driver.prefs = merged;
        break;
      }
      default:
        return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
    }
    return NextResponse.json(await buildState(auth.driverId, auth.driver), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[driver/shift POST]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
