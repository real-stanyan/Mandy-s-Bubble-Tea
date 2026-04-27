import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ATTEMPTS = 3;

export async function POST(req: NextRequest) {
  let body: { jobToken?: string; status?: string; code?: string };
  try { body = await req.json(); } catch { body = {}; }

  const token = body.jobToken;
  if (!token) return NextResponse.json({ error: "missing jobToken" }, { status: 400 });

  const sb = getSupabaseAdmin();
  const { data: row } = await sb
    .from("cup_label_jobs")
    .select("id, attempts")
    .eq("printer_token", token)
    .maybeSingle();

  if (!row) return NextResponse.json({ ok: true }); // unknown token, no-op

  if (body.status === "ok") {
    await sb
      .from("cup_label_jobs")
      .update({ status: "printed", printed_at: new Date().toISOString() })
      .eq("id", row.id);
  } else {
    const finalStatus = (row.attempts ?? 0) >= MAX_ATTEMPTS ? "failed" : "pending";
    await sb
      .from("cup_label_jobs")
      .update({
        status: finalStatus,
        printer_token: null,
        last_error: body.code ?? body.status ?? "error",
      })
      .eq("id", row.id);
  }

  return NextResponse.json({ ok: true });
}
