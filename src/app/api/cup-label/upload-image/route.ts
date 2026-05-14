// src/app/api/cup-label/upload-image/route.ts
//
// Customer uploads a photo from their device. The image runs through the
// same 300dpi 1-bit thermal pipeline as AI-generated doodles (resize →
// sharpen → grayscale → threshold @ 128), is stored in the same Storage
// path as AI doodles, and yields an id the app passes back at checkout
// via `aiDoodleIds`. The server doesn't distinguish "AI generated" from
// "user uploaded" — both are pre-rendered PNGs ready for ZPL ^GFA pack.

import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth";
import { saveAiDoodleUpload, aiDoodlePreviewUrl } from "@/lib/doodle/upload-store";
import { binarizeForThermal } from "@/lib/doodle/binarize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024; // 8 MB raw image cap

type Body = { imageBase64: string };

function isValidBody(body: unknown): body is Body {
  if (!body || typeof body !== "object") return false;
  const b = body as Partial<Body>;
  return typeof b.imageBase64 === "string" && b.imageBase64.length > 100;
}

// Accepts either "data:image/<x>;base64,XXXX" (data URI) or raw base64.
function decodeBase64Image(input: string): Buffer {
  const match = input.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  const raw = match ? match[1] : input;
  return Buffer.from(raw, "base64");
}

export async function POST(request: NextRequest) {
  const user = await getAuthedUser(request);
  if (!user) {
    return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  if (!isValidBody(body)) {
    return NextResponse.json({ ok: false, error: "Missing imageBase64" }, { status: 400 });
  }

  let raw: Buffer;
  try {
    raw = decodeBase64Image(body.imageBase64);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid image data" }, { status: 400 });
  }
  if (raw.length === 0) {
    return NextResponse.json({ ok: false, error: "Empty image" }, { status: 400 });
  }
  if (raw.length > MAX_PAYLOAD_BYTES) {
    return NextResponse.json(
      { ok: false, error: `Image too large (max ${MAX_PAYLOAD_BYTES / 1024 / 1024} MB)` },
      { status: 413 },
    );
  }

  // Photo binarisation: contrast-boost + half-res Atkinson dither +
  // 2× nearest-neighbour upscale. See lib/doodle/binarize.ts for why
  // this combo is the right call at 300dpi (FS at full res prints as
  // too-noisy fine dot pattern; pure threshold crushes photos into
  // black blobs; Atkinson at half-res gives newspaper-halftone clarity).
  let processedPng: Buffer;
  try {
    processedPng = await binarizeForThermal(raw, { mode: "atkinson" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[upload-image] preprocess failed:", msg);
    return NextResponse.json(
      { ok: false, error: "Image processing failed (unsupported format?)" },
      { status: 400 },
    );
  }

  try {
    const { aiDoodleId } = await saveAiDoodleUpload({
      userId: user.userId,
      pngBuffer: processedPng,
    });
    const previewUrl = await aiDoodlePreviewUrl(user.userId, aiDoodleId);
    console.log(
      `[upload-image] ok userId=${user.userId} id=${aiDoodleId.slice(0, 8)} bytes=${raw.length}`,
    );
    return NextResponse.json({ ok: true, uploadedDoodleId: aiDoodleId, previewUrl });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[upload-image] storage upload failed:", msg);
    return NextResponse.json({ ok: false, error: "Storage upload failed" }, { status: 500 });
  }
}
