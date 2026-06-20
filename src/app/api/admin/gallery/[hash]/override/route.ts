// src/app/api/admin/gallery/[hash]/override/route.ts
import { NextResponse } from "next/server";
import { isAuthedGalleryAdmin } from "@/lib/cup-label/gallery-admin-auth";
import { clearOverride } from "@/lib/cup-label/gallery-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ hash: string }> };

export async function DELETE(request: Request, ctx: Ctx) {
  const auth = isAuthedGalleryAdmin(request);
  if (!auth.ok) return NextResponse.json({ ok: false, reason: auth.reason }, { status: auth.reason === "unconfigured" ? 500 : 401 });
  const { hash } = await ctx.params;
  const r = await clearOverride(hash);
  if (!r.ok) return NextResponse.json(r, { status: r.reason === "not_found" ? 404 : 500 });
  return NextResponse.json(r);
}
