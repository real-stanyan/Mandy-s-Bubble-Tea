import { NextResponse } from "next/server";
import {
  getEffectiveOrderingStatus,
  getDeliveryPause,
  isDeliveryEnabled,
} from "@/lib/store-status-server";
import { getKitchenLoad } from "@/lib/kitchen-load-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const now = new Date();
  const [status, deliveryEnabled, deliveryPause, kitchen] = await Promise.all([
    getEffectiveOrderingStatus(now),
    isDeliveryEnabled(),
    getDeliveryPause(),
    // Live "how long until an ASAP pickup is ready", from the cups on the
    // bench right now. Null when Square can't be asked — clients show the
    // middle bracket rather than nothing (see kitchen-load.ts).
    getKitchenLoad(now),
  ]);
  return NextResponse.json(
    // deliveryPause is present only while a pause is live, and tells the UI
    // WHY delivery is off (maintenance) and when it's back — "unavailable"
    // with no reason reads as broken.
    { ...status, deliveryEnabled, deliveryPause, kitchen },
    {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=30",
      },
    },
  );
}
