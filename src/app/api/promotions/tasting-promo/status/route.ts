import { NextResponse } from "next/server";
import { getActiveTastingPromo } from "@/lib/tasting-promo";

// Read-only status endpoint — what the app's tasting-promo card renders from.
//
// No auth: the promo is store-wide for the window (there is no per-customer
// grant to look up), so there is nothing here a signed-out app user shouldn't
// see. It is still app-facing rather than public in spirit — the web checkout
// deliberately never asks, because the discount is app-only.
//
// Never errors: a lookup failure surfaces as `available: false`, same
// fail-safe as the pricing path, so a Supabase hiccup hides the card instead
// of breaking the app's home screen.

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getActiveTastingPromo();
  return NextResponse.json({ ok: true, ...status });
}
