import { NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth";
import {
  DIAMOND_MONTHLY_FREE_TOPPINGS,
  brisbaneMonthKey,
} from "@/lib/membership-tier";
import { getToppingAllowanceStatus } from "@/lib/tier-toppings-store";

export const dynamic = "force-dynamic";

// Remaining diamond free-topping quota for the signed-in member this
// Brisbane month. Display-only — the orders route re-derives everything.
export async function GET(request: Request) {
  const user = await getAuthedUser(request);
  const customerId = user?.profile?.square_customer_id;
  if (!customerId) {
    return NextResponse.json({
      ok: true,
      remaining: 0,
      limit: DIAMOND_MONTHLY_FREE_TOPPINGS,
    });
  }
  const status = await getToppingAllowanceStatus(customerId, brisbaneMonthKey());
  return NextResponse.json({
    ok: true,
    remaining: status.remaining,
    limit: DIAMOND_MONTHLY_FREE_TOPPINGS,
    monthKey: status.monthKey,
  });
}
