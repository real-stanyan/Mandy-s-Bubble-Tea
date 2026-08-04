import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { getAdminUserId } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

// Moves a failed/stale job out of the actionable list by marking it
// 'printed'. Owner-gated. Used when the sticker has been handled
// manually (written by hand, printed from a different device, etc.)
// and the row is just clutter in /admin/prints.
export async function POST(request: Request) {
  const userId = await getAdminUserId();
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
