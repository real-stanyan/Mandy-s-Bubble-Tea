import { NextResponse } from "next/server";
import { getWelcomeDiscountStatus } from "@/lib/supabase";

// Read-only status endpoint. Used by home banner, account card, and
// checkout. Returns `{ ok: true, available: boolean, percentage: number }`.
// Missing / invalid customerId → `available: false` (never errors out).

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const customerId = searchParams.get("customerId");
  if (!customerId) {
    return NextResponse.json({ ok: true, available: false, percentage: 0 });
  }
  const status = await getWelcomeDiscountStatus(customerId);
  return NextResponse.json({ ok: true, ...status });
}
