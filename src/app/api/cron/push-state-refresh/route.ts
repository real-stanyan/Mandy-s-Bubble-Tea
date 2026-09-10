import { NextResponse } from "next/server";
import { bearerTokenMatches } from "@/lib/bearer-auth";
import { squareClient, SQUARE_LOCATION_ID } from "@/lib/square";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { refreshCustomerState } from "@/lib/push-center/refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Every half hour: fold the orders that settled since the last run into
// push_customer_state, so /staff/push reads a table that is at most thirty
// minutes behind the till. Sends nothing — sending is a person on the page.
export async function GET(request: Request) {
  // Fail closed when CRON_SECRET is unset (preview deploys) so the public
  // internet can't make us scan Square.
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[cron/push-state-refresh] CRON_SECRET not configured");
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  if (!bearerTokenMatches(request, expected)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    const result = await refreshCustomerState({
      square: squareClient,
      locationId: SQUARE_LOCATION_ID,
      admin: getSupabaseAdmin(),
    });
    console.log("[cron/push-state-refresh]", JSON.stringify(result));
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/push-state-refresh] failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
