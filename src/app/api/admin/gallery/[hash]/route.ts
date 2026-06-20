import { NextResponse } from "next/server";
import { isAuthedGalleryAdmin } from "@/lib/cup-label/gallery-admin-auth";
import { setHidden, softDeletePreset } from "@/lib/cup-label/gallery-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ hash: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  const auth = isAuthedGalleryAdmin(request);
  if (!auth.ok)
    return NextResponse.json(
      { ok: false, reason: auth.reason },
      { status: auth.reason === "unconfigured" ? 500 : 401 }
    );
  const { hash } = await ctx.params;
  const body = (await request.json().catch(() => null)) as
    | { hidden?: unknown }
    | null;
  if (typeof body?.hidden !== "boolean")
    return NextResponse.json(
      { ok: false, error: "hidden boolean required" },
      { status: 400 }
    );
  await setHidden(hash, body.hidden);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, ctx: Ctx) {
  const auth = isAuthedGalleryAdmin(request);
  if (!auth.ok)
    return NextResponse.json(
      { ok: false, reason: auth.reason },
      { status: auth.reason === "unconfigured" ? 500 : 401 }
    );
  const { hash } = await ctx.params;
  const r = await softDeletePreset(hash);
  if (!r.ok)
    return NextResponse.json(r, {
      status: r.reason === "not_found" ? 404 : 409,
    });
  return NextResponse.json(r);
}
