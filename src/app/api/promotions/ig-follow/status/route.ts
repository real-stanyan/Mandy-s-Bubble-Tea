import { NextResponse } from "next/server";
import { getIgFollowDiscountStatus } from "@/lib/ig-follow-discount";
import { getAuthedUser } from "@/lib/auth";

// Read-only status endpoint. Used by /account/promotions and the cart
// drawer. Customer is derived from the Supabase session; signed-out or
// incomplete-signup users always see `available: false` (never errors).

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
      claimedAt: null,
      redeemedAt: null,
    });
  }
  const status = await getIgFollowDiscountStatus(customerId);
  return NextResponse.json({ ok: true, ...status });
}
