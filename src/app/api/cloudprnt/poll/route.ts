import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { buildLabelJob } from "@/lib/star/raster";
import { LABEL_WIDTH_DOTS, LABEL_HEIGHT_DOTS } from "@/lib/cup-label/render-tsp100";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WIDTH_BYTES = LABEL_WIDTH_DOTS / 8;

export async function POST() {
  const sb = getSupabaseAdmin();

  const { data: claimed, error: claimErr } = await sb.rpc("claim_oldest_cup_label_job");
  if (claimErr) {
    return NextResponse.json({ error: claimErr.message }, { status: 500 });
  }
  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ jobReady: false });
  }
  const job = claimed[0] as { id: string; raster_path: string; printer_token: string };

  const { data: file, error: dlErr } = await sb.storage.from("doodles").download(job.raster_path);
  if (dlErr || !file) {
    await markFailed(sb, job.id, dlErr?.message ?? "download failed");
    return NextResponse.json({ jobReady: false });
  }

  const bitmap = Buffer.from(await file.arrayBuffer());
  const stream = buildLabelJob(bitmap, WIDTH_BYTES, LABEL_HEIGHT_DOTS);

  return new Response(new Uint8Array(stream), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.star.starprnt",
      "X-Star-Job-Token": job.printer_token,
    },
  });
}

export const GET = POST;

async function markFailed(sb: ReturnType<typeof getSupabaseAdmin>, id: string, err: string) {
  await sb
    .from("cup_label_jobs")
    .update({ status: "failed", last_error: err })
    .eq("id", id);
}
