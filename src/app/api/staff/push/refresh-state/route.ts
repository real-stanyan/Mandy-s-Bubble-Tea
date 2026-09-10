import { NextResponse } from "next/server";
import { hasAtLeast } from "@/lib/staff/auth";
import { squareClient, SQUARE_LOCATION_ID } from "@/lib/square";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { refreshCustomerState } from "@/lib/push-center/refresh";
import { stateSummary } from "@/lib/push-center/state-store";

export const dynamic = "force-dynamic";
// Up to a week of orders in one go when the cron has been quiet.
export const maxDuration = 120;

// "Refresh now" on /staff/push — the same step the half-hourly cron takes.
export async function POST() {
  if (!(await hasAtLeast("owner"))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  try {
    const admin = getSupabaseAdmin();
    const result = await refreshCustomerState({ square: squareClient, locationId: SQUARE_LOCATION_ID, admin });
    return NextResponse.json({ ok: true, result, state: await stateSummary(admin) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
