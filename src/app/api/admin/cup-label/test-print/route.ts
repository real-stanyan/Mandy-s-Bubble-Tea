import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { getAdminUserId } from "@/lib/admin-auth";
import { renderCupLabel } from "@/lib/cup-label/render-zebra-cup";
import { POOL } from "@/lib/doodle/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const userId = await getAdminUserId();
  if (!userId) return NextResponse.json({ ok: false }, { status: 401 });

  const { drinkName = "TEST DRINK", modifiersText = "TEST · M", poolKey = "bunny" } =
    (await req.json().catch(() => ({}))) as { drinkName?: string; modifiersText?: string; poolKey?: string };
  const item = POOL.find(p => p.key === poolKey) ?? POOL[0];

  const { zpl } = await renderCupLabel({
    stickerNumber: "TEST",
    cupIdxOf: { idx: 1, total: 1 },
    drinkName,
    modifiersText,
    doodleSvg: item.svg,
  });

  const sb = getSupabaseAdmin();
  const orderId = `test-${Date.now()}`;
  const path = `${orderId}/test_0.zpl`;
  const { error: upErr } = await sb.storage
    .from("doodles")
    .upload(path, zpl, { contentType: "text/plain; charset=utf-8" });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const { data, error } = await sb
    .from("cup_label_jobs")
    .insert({
      square_order_id: orderId,
      line_id: "test-line",
      cup_idx: 0,
      sticker_number: "TEST",
      drink_name: drinkName,
      modifiers_text: modifiersText,
      doodle_source: "default",
      doodle_pool_key: item.key,
      raster_path: path,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, jobId: data.id });
}
