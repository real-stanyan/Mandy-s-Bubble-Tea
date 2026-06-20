import { NextResponse } from "next/server";
import { isAuthedGalleryAdmin } from "@/lib/cup-label/gallery-admin-auth";
import { processGalleryImage } from "@/lib/cup-label/gallery-process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_IMAGES = 30;

function decode(input: string): Buffer {
  const m = input.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  return Buffer.from(m ? m[1] : input, "base64");
}

export async function POST(request: Request) {
  const auth = isAuthedGalleryAdmin(request);
  if (!auth.ok) return NextResponse.json({ ok: false, reason: auth.reason }, { status: auth.reason === "unconfigured" ? 500 : 401 });

  const body = (await request.json().catch(() => null)) as { images?: unknown } | null;
  const images = Array.isArray(body?.images) ? (body!.images as unknown[]) : null;
  if (!images || images.length === 0) return NextResponse.json({ ok: false, error: "images required" }, { status: 400 });
  if (images.length > MAX_IMAGES) return NextResponse.json({ ok: false, error: `max ${MAX_IMAGES} images` }, { status: 413 });

  const results = await Promise.all(images.map(async (img) => {
    try {
      if (typeof img !== "string") return { error: "not a string" };
      const raw = decode(img);
      if (raw.length === 0) return { error: "empty image" };
      if (raw.length > MAX_BYTES) return { error: "image too large" };
      const { hash, colorPng, binarizedPng } = await processGalleryImage(raw);
      return {
        hash,
        colorDataUrl: `data:image/png;base64,${colorPng.toString("base64")}`,
        binarizedDataUrl: `data:image/png;base64,${binarizedPng.toString("base64")}`,
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "processing failed" };
    }
  }));

  return NextResponse.json({ ok: true, results });
}
