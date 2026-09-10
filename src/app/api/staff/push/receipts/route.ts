import { NextResponse } from "next/server";
import { hasAtLeast } from "@/lib/staff/auth";
import { checkRunReceipts } from "@/lib/push-center/send.server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Re-ask Expo about a run's receipts. The send schedules one check ten
// seconds after the fact; this is the button for when that wasn't enough
// (Expo keeps receipts for a day).
export async function POST(request: Request) {
  if (!(await hasAtLeast("owner"))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const body = (await request.json().catch(() => ({}))) as { runId?: string };
  const runId = typeof body.runId === "string" ? body.runId.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(runId)) {
    return NextResponse.json({ ok: false, error: "runId required" }, { status: 400 });
  }
  try {
    const summary = await checkRunReceipts(runId);
    return NextResponse.json({ ok: true, runId, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
