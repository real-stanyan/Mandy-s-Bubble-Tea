import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { aiDoodlePreviewUrl } from "@/lib/doodle/upload-store";

// Status + preview for one AI cup-label job. The submit flow is fire-and-
// forget (the customer's response returns before Doubao runs), which used to
// mean the customer never saw their result — the cart row kept a ✨
// placeholder "by design". Memory Stamp made that untenable: the whole point
// is what the stamp looks like. The row now polls this until the job lands.
//
// Ownership is enforced by keying the lookup on (id, user_id) — one customer
// can never watch another's job.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getAuthedUser(request);
  if (!user) {
    return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }

  const aiDoodleId = request.nextUrl.searchParams.get("aiDoodleId")?.trim();
  if (!aiDoodleId) {
    return NextResponse.json({ ok: false, error: "Missing aiDoodleId" }, { status: 400 });
  }

  const { data: job, error } = await getSupabaseAdmin()
    .from("cup_label_ai_jobs")
    .select("id, status")
    .eq("id", aiDoodleId)
    .eq("user_id", user.userId)
    .maybeSingle();
  if (error) {
    console.error("[ai-status] lookup failed:", error.message);
    return NextResponse.json({ ok: false, error: "Lookup failed" }, { status: 500 });
  }
  if (!job) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  if (job.status !== "ready") {
    return NextResponse.json({ ok: true, status: job.status });
  }

  try {
    const previewUrl = await aiDoodlePreviewUrl(user.userId, aiDoodleId);
    return NextResponse.json({ ok: true, status: "ready", previewUrl });
  } catch (e) {
    // Row says ready but the object is missing/unsignable — report pending
    // rather than failed so the client's poll just keeps the placeholder.
    console.error(
      "[ai-status] sign failed:",
      e instanceof Error ? e.message : e,
    );
    return NextResponse.json({ ok: true, status: "pending" });
  }
}
