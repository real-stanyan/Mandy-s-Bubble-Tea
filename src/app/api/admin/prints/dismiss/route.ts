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

// Moves a failed/stale job out of the actionable list by marking it
// 'printed'. Owner-gated. Used when the sticker has been handled
// manually (written by hand, printed from a different device, etc.)
// and the row is just clutter in /admin/prints.
export async function POST(request: Request) {
  const userId = await assertOwner();
  if (!userId) return NextResponse.json({ ok: false }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { id?: string };
  if (!body.id) return NextResponse.json({ ok: false, error: "missing id" }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from("print_jobs")
    .update({
      status: "printed",
      printed_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", body.id)
    .in("status", ["failed", "stale"]);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
