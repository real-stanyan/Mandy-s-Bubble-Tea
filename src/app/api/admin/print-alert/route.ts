// src/app/api/admin/print-alert/route.ts
import { NextResponse } from "next/server";
import { notifyOwnersPrinterAlert } from "@/lib/printer-alert";

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
  const message = String(body.message ?? "") || "printer alert";
  const deviceId = String(body.deviceId ?? "unknown");

  const delivered = await notifyOwnersPrinterAlert(deviceId, message);
  console.log(`[print-alert] delivered ${delivered} device=${deviceId}`);
  return NextResponse.json({ ok: true, delivered });
}
