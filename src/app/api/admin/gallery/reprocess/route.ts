// src/app/api/admin/gallery/reprocess/route.ts
import { NextResponse } from "next/server";
import { isAuthedGalleryAdmin } from "@/lib/cup-label/gallery-admin-auth";
import { getRecipe, colorThumb } from "@/lib/cup-label/recipes";
import { loadSourceColor, uploadBucketArtifacts, setOverride } from "@/lib/cup-label/gallery-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024;
// Gallery hash format: alphanumeric + dash/underscore, 1-64 chars (matches sibling enqueue.ts)
const HASH_RE = /^[A-Za-z0-9_-]{1,64}$/;

function decode(input: string): Buffer {
  const m = input.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  return Buffer.from(m ? m[1] : input, "base64");
}

export async function POST(request: Request) {
  const auth = isAuthedGalleryAdmin(request);
  if (!auth.ok) return NextResponse.json({ ok: false, reason: auth.reason }, { status: auth.reason === "unconfigured" ? 500 : 401 });

  const body = (await request.json().catch(() => null)) as
    | { hash?: string; recipeId?: string; image?: string; commit?: boolean }
    | null;
  if (!body?.hash || typeof body.hash !== "string") return NextResponse.json({ ok: false, error: "hash required" }, { status: 400 });
  if (!HASH_RE.test(body.hash)) return NextResponse.json({ ok: false, error: "bad hash" }, { status: 400 });

  const recipe = getRecipe(body.recipeId ?? "");
  if (!recipe) return NextResponse.json({ ok: false, reason: "bad_recipe" }, { status: 400 });

  let source: Buffer | null;
  if (typeof body.image === "string" && body.image.length > 0) {
    source = decode(body.image);
    if (source.length === 0 || source.length > MAX_BYTES) return NextResponse.json({ ok: false, error: "bad image" }, { status: 400 });
  } else {
    source = await loadSourceColor(body.hash);
  }
  if (!source) return NextResponse.json({ ok: false, reason: "needs_upload" }, { status: 400 });

  let binarized: Buffer, color: Buffer;
  try {
    binarized = await recipe.run(source);
    color = await colorThumb(source);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "processing failed" }, { status: 500 });
  }

  if (body.commit !== true) {
    return NextResponse.json({
      ok: true,
      binarizedDataUrl: `data:image/png;base64,${binarized.toString("base64")}`,
      colorDataUrl: `data:image/png;base64,${color.toString("base64")}`,
    });
  }

  await uploadBucketArtifacts(body.hash, color, binarized);
  await setOverride(body.hash);
  return NextResponse.json({ ok: true, hash: body.hash });
}
