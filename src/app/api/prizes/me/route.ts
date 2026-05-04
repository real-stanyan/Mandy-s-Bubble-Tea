import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { getAuthedUser } from "@/lib/auth";
import { TIER_LABELS } from "@/lib/lottery/types";

export async function GET(request: Request) {
  const user = await getAuthedUser(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const supa = getSupabaseAdmin();
  const { data, error } = await supa
    .from("prize_rolls")
    .select("id, tier_id, prize_type, expires_at, claim_code")
    .eq("user_id", user.userId)
    .eq("status", "won_active")
    .neq("prize_type", "thank_you")
    .gt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const prizes = (data ?? []).map((row) => ({
    id: row.id,
    tier_id: row.tier_id,
    prize_type: row.prize_type,
    label: TIER_LABELS[row.tier_id] ?? row.tier_id,
    expires_at: row.expires_at,
    claim_code: row.claim_code ?? undefined,
  }));
  return NextResponse.json(
    { prizes },
    { headers: { "cache-control": "no-store" } },
  );
}
