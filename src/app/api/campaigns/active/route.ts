import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";

export async function GET() {
  const supa = getSupabaseAdmin();
  const now = new Date().toISOString();
  const { data, error } = await supa
    .from("campaigns")
    .select("id, name, starts_at, ends_at, prize_pool")
    .eq("is_active", true)
    .lte("starts_at", now)
    .gte("ends_at", now)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(
    { campaign: data ?? null },
    { headers: { "cache-control": "no-store" } },
  );
}
