import { NextResponse } from "next/server";
import {
  getEffectiveOrderingStatus,
  isDeliveryEnabled,
} from "@/lib/store-status-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const [status, deliveryEnabled] = await Promise.all([
    getEffectiveOrderingStatus(new Date()),
    isDeliveryEnabled(),
  ]);
  return NextResponse.json(
    { ...status, deliveryEnabled },
    {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=30",
      },
    },
  );
}
