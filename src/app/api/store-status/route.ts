import { NextResponse } from "next/server";
import { getEffectiveOrderingStatus } from "@/lib/store-status";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getEffectiveOrderingStatus(new Date());
  return NextResponse.json(status, {
    headers: {
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=30",
    },
  });
}
