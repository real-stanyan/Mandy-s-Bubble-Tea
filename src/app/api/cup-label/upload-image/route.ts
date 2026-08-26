// src/app/api/cup-label/upload-image/route.ts
//
// Customer uploads a photo from their device. The image runs through the
// same 300dpi 1-bit thermal pipeline as AI-generated doodles (resize →
// sharpen → grayscale → threshold @ 128), is stored in the same Storage
// path as AI doodles, and yields an id the app passes back at checkout
// via `aiDoodleIds`. The server doesn't distinguish "AI generated" from
// "user uploaded" — both are pre-rendered PNGs ready for ZPL ^GFA pack.

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import sharp from "sharp";
import { getAuthedUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { aiDoodlePreviewUrl } from "@/lib/doodle/upload-store";
import { binarizeForThermal } from "@/lib/doodle/binarize";
import { autoOrientImage } from "@/lib/doodle/orient";
import {
  PHOTO_LABELS_OFFLINE,
  PHOTO_LABELS_OFFLINE_NOTICE,
} from "@/lib/cup-label/label-mode";

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
  // 40×30 text-only paper mode: photo labels can't print — reject early
  // so no orphaned uploads accumulate. See lib/cup-label/label-mode.ts.
  if (PHOTO_LABELS_OFFLINE) {
    return NextResponse.json(
      { ok: false, error: "photo_labels_offline", message: PHOTO_LABELS_OFFLINE_NOTICE },
      { status: 503 },
    );
  }
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

  // Bake EXIF orientation into the pixels up front. Camera selfies arrive
  // with an Orientation tag (portrait shots are stored landscape); without
  // this the binarised print + the color original both came out rotated
  // 90° (OL848). Do it once here so both downstream sharp passes below get
  // upright pixels. Non-fatal: fall back to the raw bytes if it throws.
  try {
    raw = await autoOrientImage(raw);
  } catch (e) {
    console.warn(
      "[upload-image] auto-orient failed, using raw bytes:",
      e instanceof Error ? e.message : e,
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

  // The tracker row id becomes the customer-facing uploadedDoodleId.
  // The processed PNG is stored at the existing path scheme so that
  // legacy loadAiDoodleUpload(userId, id) continues to resolve it.
  // The raw color PNG goes under uploads-originals/ for the admin
  // cup-doodles gallery.
  const id = randomUUID();
  const sb = getSupabaseAdmin();
  const processedPath = `${user.userId}/ai/${id}.png`;
  const originalPath = `${user.userId}/uploads-originals/${id}.png`;

  try {
    const { error: procErr } = await sb.storage
      .from("doodles_pending")
      .upload(processedPath, processedPng, { contentType: "image/png", upsert: false });
    if (procErr) throw new Error(`processed upload: ${procErr.message}`);

    // Color original — non-fatal. Failures here just mean the cup
    // doesn't show up in the admin gallery; the print path is fine.
    // Resize to 1280-max because the doodles_pending bucket caps
    // single objects at 5MB and modern phone photos easily exceed
    // that even after PNG re-encode.
    try {
      const colorPng = await sharp(raw)
        .resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer();
      const { error: origErr } = await sb.storage
        .from("doodles_pending")
        .upload(originalPath, colorPng, { contentType: "image/png", upsert: false });
      if (origErr) {
        console.warn(`[upload-image] color-original upload failed (non-fatal): ${origErr.message}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[upload-image] color-original step threw (non-fatal): ${msg}`);
    }

    const { error: insErr } = await sb.from("cup_label_upload_jobs").insert({
      id,
      user_id: user.userId,
      original_path: originalPath,
      processed_path: processedPath,
    });
    if (insErr) {
      // We have the PNGs but no tracker row. The cup will still
      // print (loadAiDoodleUpload will fall through to the legacy
      // bucket-only path), but it won't show in the admin gallery.
      console.warn(`[upload-image] tracker insert failed (non-fatal): ${insErr.message}`);
    }

    const previewUrl = await aiDoodlePreviewUrl(user.userId, id);
    console.log(
      `[upload-image] ok userId=${user.userId} id=${id.slice(0, 8)} bytes=${raw.length}`,
    );
    return NextResponse.json({ ok: true, uploadedDoodleId: id, previewUrl });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[upload-image] storage upload failed:", msg);
    return NextResponse.json({ ok: false, error: "Storage upload failed" }, { status: 500 });
  }
}
