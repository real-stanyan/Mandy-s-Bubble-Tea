// src/app/api/admin/print-alert/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { sendExpoPush } from "@/lib/push";

export const dynamic = "force-dynamic";

type AlertBody = {
  deviceId?: string;
  message?: string;
  at?: string;
};

export async function POST(request: Request) {
  const expected = process.env.PRINTER_ALERT_TOKEN;
  if (!expected) {
    console.error("[print-alert] PRINTER_ALERT_TOKEN not configured on server");
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  let body: AlertBody;
  try {
    body = (await request.json()) as AlertBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const message = String(body.message ?? "").slice(0, 280) || "printer alert";
  const deviceId = String(body.deviceId ?? "unknown");

  const admin = getSupabaseAdmin();

  // Find all owner user_ids, then their device push tokens.
  const { data: owners, error: ownerErr } = await admin
    .from("admin_users")
    .select("user_id")
    .eq("role", "owner");
  if (ownerErr) {
    console.error("[print-alert] admin_users query failed:", ownerErr.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  const ownerIds = (owners ?? []).map((r: { user_id: string }) => r.user_id);
  if (ownerIds.length === 0) {
    console.warn("[print-alert] no owners configured");
    return NextResponse.json({ ok: true, delivered: 0 });
  }
  const { data: tokens, error: tokensErr } = await admin
    .from("device_push_tokens")
    .select("token")
    .in("user_id", ownerIds);
  if (tokensErr) {
    console.error("[print-alert] push tokens query failed:", tokensErr.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  const pushTokens = (tokens ?? []).map((t: { token: string }) => t.token);
  if (pushTokens.length === 0) {
    return NextResponse.json({ ok: true, delivered: 0 });
  }

  const delivered = await sendExpoPush(pushTokens, {
    title: "Printer alert",
    body: `${deviceId}: ${message}`,
    data: { kind: "printer-alert", deviceId, message },
  });
  console.log(`[print-alert] delivered ${delivered}/${pushTokens.length} device=${deviceId}`);
  return NextResponse.json({ ok: true, delivered });
}
