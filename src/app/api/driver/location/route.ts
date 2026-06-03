import { NextResponse } from "next/server";
import { isAuthedDriver } from "@/lib/driver-auth";
import { updateDriverLocation } from "@/lib/driver-tokens";

// Driver app streams its GPS position here while a delivery is in progress.
// Fire-and-forget from the device every ~10s; we stash the latest fix on the
// delivery_dispatch row for the customer's live map. Bearer-guarded with the
// same shared STAFF_DELIVERY_TOKEN as the rest of /api/driver/*.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = isAuthedDriver(request);
  if (!auth.ok) {
    if (auth.reason === "unconfigured") {
      console.error("[driver/location] STAFF_DELIVERY_TOKEN not set on server");
      return NextResponse.json({ ok: false }, { status: 500 });
    }
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  let body: { orderId?: string; lat?: number; lng?: number; heading?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid json" },
      { status: 400 },
    );
  }

  const { orderId, lat, lng } = body;
  const heading = body.heading;
  if (
    !orderId ||
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  ) {
    return NextResponse.json(
      { ok: false, error: "orderId, lat, lng required" },
      { status: 400 },
    );
  }

  try {
    await updateDriverLocation({
      orderId,
      lat,
      lng,
      heading: typeof heading === "number" && Number.isFinite(heading) ? heading : null,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[driver/location]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
