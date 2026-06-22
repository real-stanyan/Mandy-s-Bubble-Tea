import { NextResponse } from "next/server";
import { isAuthedGalleryAdmin } from "@/lib/cup-label/gallery-admin-auth";
import { generateGalleryImage, type GenMode } from "@/lib/cup-label/minimax-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// MiniMax generation runs ~12–30s; give the function headroom over the default.
export const maxDuration = 90;

const MAX_PROMPT = 800;
const MAX_BYTES = 8 * 1024 * 1024;

function decode(input: string): Buffer {
  const m = input.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  return Buffer.from(m ? m[1] : input, "base64");
}

export async function POST(request: Request) {
  const auth = isAuthedGalleryAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, reason: auth.reason }, { status: auth.reason === "unconfigured" ? 500 : 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | { mode?: string; prompt?: string; image?: string }
    | null;

  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return NextResponse.json({ ok: false, error: "prompt required" }, { status: 400 });
  if (prompt.length > MAX_PROMPT) return NextResponse.json({ ok: false, error: "prompt too long" }, { status: 400 });

  const mode: GenMode = body?.mode === "image" ? "image" : "text";
  let refImage: Buffer | undefined;
  if (mode === "image") {
    if (typeof body?.image !== "string" || body.image.length === 0) {
      return NextResponse.json({ ok: false, error: "reference image required for image mode" }, { status: 400 });
    }
    refImage = decode(body.image);
    if (refImage.length === 0 || refImage.length > MAX_BYTES) {
      return NextResponse.json({ ok: false, error: "bad reference image" }, { status: 400 });
    }
  }

  try {
    const png = await generateGalleryImage({ mode, prompt, refImage });
    return NextResponse.json({ ok: true, image: `data:image/png;base64,${png.toString("base64")}` });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "generation failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
