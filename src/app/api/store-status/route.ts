import { NextResponse } from "next/server";
import {
  getEffectiveOrderingStatus,
  getDeliveryPause,
  isDeliveryEnabled,
} from "@/lib/store-status-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const [status, deliveryEnabled, deliveryPause] = await Promise.all([
    getEffectiveOrderingStatus(new Date()),
    isDeliveryEnabled(),
    getDeliveryPause(),
  ]);
  return NextResponse.json(
    // deliveryPause is present only while a pause is live, and tells the UI
    // WHY delivery is off (maintenance) and when it's back — "unavailable"
    // with no reason reads as broken.
    { ...status, deliveryEnabled, deliveryPause },
    {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=30",
      },
    },
  );
}
