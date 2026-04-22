import { NextResponse } from "next/server";
import { getSupabaseAdmin, getSupabaseRoute } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

async function assertOwner(): Promise<string | null> {
  const ssr = await getSupabaseRoute();
  const { data: { user } } = await ssr.auth.getUser();
  if (!user) return null;
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("admin_users")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  return data ? user.id : null;
}

export async function POST(request: Request) {
  const userId = await assertOwner();
  if (!userId) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { id?: string };
  if (!body.id) return NextResponse.json({ ok: false, error: "missing id" }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { data: orig, error: origErr } = await admin
    .from("print_jobs")
    .select("*")
    .eq("id", body.id)
    .maybeSingle();
  if (origErr || !orig) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  const synthetic = `reprint:${orig.square_order_id}:${new Date().toISOString()}`;
  const { data: cloned, error: cloneErr } = await admin
    .from("print_jobs")
    .insert({
      square_order_id: synthetic,
      source: orig.source,
      sticker_number: orig.sticker_number,
      order_total_cents: orig.order_total_cents,
      cups: orig.cups,
      status: "pending",
    })
    .select()
    .single();
  if (cloneErr) return NextResponse.json({ ok: false, error: cloneErr.message }, { status: 500 });
  return NextResponse.json({ ok: true, clonedId: cloned.id });
}
