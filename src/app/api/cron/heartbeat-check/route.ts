// src/app/api/cron/heartbeat-check/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { notifyOwnersPrinterAlert } from "@/lib/printer-alert";
import { bearerTokenMatches } from "@/lib/bearer-auth";

export const dynamic = "force-dynamic";

// A heartbeat is considered stale if it hasn't updated in this long.
// The client posts every 30s, so 3 minutes catches a real outage with
// some slack for transient network hiccups.
const STALE_AFTER_MS = 3 * 60 * 1000;

// Once we've alerted for a given device, wait this long before
// alerting again if it's still stale. Avoids spamming the owner.
const RE_ALERT_AFTER_MS = 10 * 60 * 1000;

export async function GET(request: Request) {
  // Vercel attaches Authorization: Bearer <CRON_SECRET>. We FAIL CLOSED if
  // CRON_SECRET is unset (e.g. a preview deploy missing the prod secret) so
  // this endpoint can never be triggered by the public internet to spam push
  // notifications. Constant-time compare via bearerTokenMatches.
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("[cron/heartbeat-check] CRON_SECRET not configured");
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  if (!bearerTokenMatches(request, expected)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const now = Date.now();
  const staleCutoff = new Date(now - STALE_AFTER_MS).toISOString();
  const reAlertCutoff = new Date(now - RE_ALERT_AFTER_MS).toISOString();

  // Find heartbeats that are stale AND we haven't alerted about recently.
  const { data: stale, error } = await admin
    .from("printer_heartbeats")
    .select("device_id, last_seen_at, stale_alert_sent_at")
    .lt("last_seen_at", staleCutoff)
    .or(`stale_alert_sent_at.is.null,stale_alert_sent_at.lt.${reAlertCutoff}`);

  if (error) {
    console.error("[cron/heartbeat-check] query failed:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  let alerted = 0;
  for (const row of stale ?? []) {
    const ageMin = Math.round((now - new Date(row.last_seen_at).getTime()) / 60000);
    const delivered = await notifyOwnersPrinterAlert(
      row.device_id,
      `printer client offline for ${ageMin} min — no stickers printing`,
    );
    await admin
      .from("printer_heartbeats")
      .update({ stale_alert_sent_at: new Date().toISOString() })
      .eq("device_id", row.device_id);
    console.log(
      `[cron/heartbeat-check] alerted device=${row.device_id} age=${ageMin}min delivered=${delivered}`,
    );
    alerted++;
  }

  return NextResponse.json({ ok: true, checked: stale?.length ?? 0, alerted });
}
