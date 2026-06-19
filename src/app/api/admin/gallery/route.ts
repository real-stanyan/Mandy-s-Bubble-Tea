import { NextResponse } from "next/server";
import { isAuthedGalleryAdmin } from "@/lib/cup-label/gallery-admin-auth";
import { listAllForAdmin } from "@/lib/cup-label/gallery-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = isAuthedGalleryAdmin(request);
  if (!auth.ok)
    return NextResponse.json(
      { ok: false, reason: auth.reason },
      { status: auth.reason === "unconfigured" ? 500 : 401 }
    );
  const presets = await listAllForAdmin();
  return NextResponse.json({ ok: true, presets });
}
