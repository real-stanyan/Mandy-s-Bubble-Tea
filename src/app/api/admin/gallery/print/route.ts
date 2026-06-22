import { NextResponse } from "next/server";
import { isAuthedGalleryAdmin } from "@/lib/cup-label/gallery-admin-auth";
import { resolvePresetBuffer } from "@/lib/cup-label/enqueue";
import { renderCupLabel } from "@/lib/cup-label/render-zebra-cup";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Gallery hash format (matches sibling routes).
const HASH_RE = /^[A-Za-z0-9_-]{1,64}$/;

// Enqueue a single test print of a gallery image to the in-store ZD410. Reuses
// the exact same cup_label_jobs → Supabase Realtime → printer-client transport
// that real orders use: insert one pending row with inline zpl_body, the local
// print agent claims it and prints. Physical output requires the in-store agent
// to be online; if it's offline the row simply waits as 'pending'.
export async function POST(request: Request) {
  const auth = isAuthedGalleryAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, reason: auth.reason }, { status: auth.reason === "unconfigured" ? 500 : 401 });
  }

  const body = (await request.json().catch(() => null)) as { hash?: string } | null;
  const hash = typeof body?.hash === "string" ? body.hash : "";
  if (!hash || !HASH_RE.test(hash)) {
    return NextResponse.json({ ok: false, error: "bad hash" }, { status: 400 });
  }

  const sb = getSupabaseAdmin();

  // Confirm the preset exists and learn whether it has a re-processed override
  // (canonical print image then lives in the bucket, not on disk).
  const { data: preset, error: lookupErr } = await sb
    .from("gallery_presets")
    .select("hash, override_at, deleted_at")
    .eq("hash", hash)
    .maybeSingle();
  if (lookupErr) return NextResponse.json({ ok: false, error: lookupErr.message }, { status: 500 });
  if (!preset || preset.deleted_at) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  let zpl: string;
  try {
    const doodlePngBuffer = await resolvePresetBuffer(hash, { hasOverride: preset.override_at != null });
    const rendered = await renderCupLabel({
      stickerNumber: "TEST",
      cupIdxOf: { idx: 1, total: 1 },
      drinkName: `图库 ${hash.slice(0, 6)}`,
      modifiersText: "测试打印",
      doodleSvg: "",
      doodlePngBuffer,
      customerFirstName: null,
    });
    zpl = rendered.zpl;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "render failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  // Unique synthetic order id keeps the (square_order_id, line_id, cup_idx,
  // copy_idx) job key collision-free per click.
  const orderId = `gallery-test-${hash.slice(0, 8)}-${Date.now()}`;
  const { data, error } = await sb
    .from("cup_label_jobs")
    .insert({
      square_order_id: orderId,
      line_id: "gallery-test",
      cup_idx: 0,
      copy_idx: 0,
      sticker_number: "TEST",
      drink_name: `图库 ${hash.slice(0, 6)}`,
      modifiers_text: "测试打印",
      doodle_source: "preset_sticker",
      raster_path: null,
      zpl_body: zpl,
      target_printer_kind: "zd410",
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, jobId: data.id });
}
