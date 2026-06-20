import { NextResponse } from "next/server";
import { isAuthedGalleryAdmin } from "@/lib/cup-label/gallery-admin-auth";
import { processGalleryImage } from "@/lib/cup-label/gallery-process";
import { uploadBucketArtifacts, insertUploadPreset } from "@/lib/cup-label/gallery-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function decode(input: string): Buffer {
  const m = input.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  return Buffer.from(m ? m[1] : input, "base64");
}

export async function POST(request: Request) {
  const auth = isAuthedGalleryAdmin(request);
  if (!auth.ok) return NextResponse.json({ ok: false, reason: auth.reason }, { status: auth.reason === "unconfigured" ? 500 : 401 });

  const body = (await request.json().catch(() => null)) as { images?: Array<{ image: string; hash: string }>; createdBy?: string } | null;
  const images = Array.isArray(body?.images) ? body!.images : null;
  if (!images || images.length === 0) return NextResponse.json({ ok: false, error: "images required" }, { status: 400 });
  const createdBy = typeof body?.createdBy === "string" ? body.createdBy : "admin";

  const committed: string[] = [];
  const failed: Array<{ hash: string; error: string }> = [];
  for (const item of images) {
    try {
      const { hash, colorPng, binarizedPng } = await processGalleryImage(decode(item.image));
      if (hash !== item.hash) { failed.push({ hash: item.hash, error: "hash mismatch" }); continue; }
      await uploadBucketArtifacts(hash, colorPng, binarizedPng);
      await insertUploadPreset(hash, createdBy);
      committed.push(hash);
    } catch (e) {
      failed.push({ hash: item.hash, error: e instanceof Error ? e.message : "commit failed" });
    }
  }
  return NextResponse.json({ ok: failed.length === 0, committed, failed });
}
