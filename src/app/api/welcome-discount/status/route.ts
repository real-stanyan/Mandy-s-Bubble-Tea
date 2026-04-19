import { NextResponse } from "next/server";
import { getWelcomeDiscountStatus } from "@/lib/supabase";
import { getAuthedUser } from "@/lib/auth";

// Read-only status endpoint. Used by the home banner, account card, and
// checkout. Customer is derived from the Supabase session; signed-out
// or incomplete-signup users always see `available: false` (never errors
// out).

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getAuthedUser(request);
  const customerId = user?.profile?.square_customer_id;
  if (!customerId) {
    return NextResponse.json({
      ok: true,
      available: false,
      percentage: 0,
      drinksRemaining: 0,
    });
  }
  const status = await getWelcomeDiscountStatus(customerId);
  return NextResponse.json({ ok: true, ...status });
}
