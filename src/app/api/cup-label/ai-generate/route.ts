// src/app/api/cup-label/ai-generate/route.ts
//
// Generate a cup-label doodle from a customer text prompt via Doubao
// Seedream 4.5 and run the result through the same Atkinson-dither
// photo pipeline used for user-uploaded photos. AI gets to generate
// whatever it would normally (colour, photo-real, illustrated — no
// forced line-art suffix); the binarisation step handles the conversion
// to a printable 1-bit thermal cup label.
//
// Result is uploaded to Storage and returned as an `aiDoodleId` that
// the client passes back at checkout (same shape as the drawn / upload
// flows). All three sources (AI / upload / hand-draw) converge into
// the same Storage path → enqueueCupLabelJobs → ZD410 ZPL pipeline.

import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { getAuthedUser } from "@/lib/auth";
import {
  saveAiDoodleUpload,
  aiDoodlePreviewUrl,
  saveAiSourceImage,
} from "@/lib/doodle/upload-store";
import { binarizeForThermal } from "@/lib/doodle/binarize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Doubao generation takes 10-30s; allow up to 60s before the route times out.
export const maxDuration = 60;

const MAX_PROMPT_LEN = 200;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

// Per-user concurrency lock. One AI generation call ties up the
// Doubao API key for 10-40s; if a user double-taps "Generate" or
// opens the modal in two tabs we get two in-flight requests against
// the same Doubao token, both eating the same Vercel function
// budget. Track userId -> in-flight count and reject the second
// with 429 so the client retries after the first lands. Per-instance
// only (Vercel functions are stateless across instances), but on
// Pro tier "fluid compute" multiple invocations share one process
// and this is enough to stop one user spamming the upstream.
const aiInFlight = new Set<string>();

type Body = {
  prompt: string;
  /** Optional reference image (data URI or raw base64) for image-to-image. */
  sourceImageBase64?: string;
};

function isValidBody(body: unknown): body is Body {
  if (!body || typeof body !== "object") return false;
  const b = body as Partial<Body>;
  if (typeof b.prompt !== "string" || b.prompt.trim().length === 0) return false;
  if (b.sourceImageBase64 !== undefined && typeof b.sourceImageBase64 !== "string")
    return false;
  return true;
}

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
    return NextResponse.json({ ok: false, error: "Missing prompt" }, { status: 400 });
  }

  const rawPrompt = body.prompt.trim();
  if (rawPrompt.length > MAX_PROMPT_LEN) {
    return NextResponse.json(
      { ok: false, error: `Prompt too long (max ${MAX_PROMPT_LEN} chars)` },
      { status: 400 },
    );
  }

  const apiKey = process.env.ARK_API_KEY;
  if (!apiKey) {
    console.error("[ai-generate] ARK_API_KEY not set");
    return NextResponse.json(
      { ok: false, error: "AI not configured" },
      { status: 500 },
    );
  }

  // Reject duplicate in-flight requests for the same user. Tell the
  // client to back off via 429 + Retry-After so a double-tap on
  // "Generate" doesn't double-charge Doubao.
  if (aiInFlight.has(user.userId)) {
    return NextResponse.json(
      { ok: false, error: "Another AI generation is still running for this account" },
      { status: 429, headers: { "Retry-After": "10" } },
    );
  }
  aiInFlight.add(user.userId);

  try {
  const t0 = Date.now();

  // 0. If the caller supplied a reference image, decode it, normalise to
  //    PNG, upload to Storage and grab a 1h signed URL that Doubao can
  //    fetch. Doubao image-to-image accepts a URL in the `image` field
  //    of the same /images/generations endpoint.
  let sourceSignedUrl: string | undefined;
  if (body.sourceImageBase64) {
    try {
      const rawSrc = decodeBase64Image(body.sourceImageBase64);
      if (rawSrc.length === 0) {
        return NextResponse.json({ ok: false, error: "Empty source image" }, { status: 400 });
      }
      if (rawSrc.length > MAX_SOURCE_BYTES) {
        return NextResponse.json(
          { ok: false, error: `Source image too large (max ${MAX_SOURCE_BYTES / 1024 / 1024} MB)` },
          { status: 413 },
        );
      }
      // Re-encode to PNG (Storage bucket allowlist + format normalisation)
      // and cap the long edge at 1024px. Doubao image-to-image is happy
      // with 1024×1024-ish inputs; full iPhone resolution would blow
      // past the bucket file_size_limit and waste bandwidth on a hop
      // that gets thumbnailed at the next step anyway.
      const pngSrc = await sharp(rawSrc)
        .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
        .png({ compressionLevel: 9 })
        .toBuffer();
      const saved = await saveAiSourceImage(user.userId, pngSrc);
      sourceSignedUrl = saved.signedUrl;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[ai-generate] source upload failed:", msg);
      return NextResponse.json(
        { ok: false, error: "Reference image upload failed" },
        { status: 400 },
      );
    }
  }

  // 1. Call Doubao. Same endpoint for text→image and image→image; the
  //    `image` field switches between them.
  let imageUrl: string;
  try {
    const doubaoBody: Record<string, unknown> = {
      model: "doubao-seedream-4-5-251128",
      prompt: rawPrompt,
      sequential_image_generation: "disabled",
      response_format: "url",
      size: "2048x2048",
      stream: false,
      watermark: false,
    };
    if (sourceSignedUrl) doubaoBody.image = sourceSignedUrl;

    const resp = await fetch("https://ark.cn-beijing.volces.com/api/v3/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(doubaoBody),
      // Allow up to 50s for the upstream response; leaves ~10s headroom.
      signal: AbortSignal.timeout(50_000),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error(`[ai-generate] Doubao ${resp.status}:`, text.slice(0, 400));
      return NextResponse.json(
        { ok: false, error: "AI generation failed, try again" },
        { status: 502 },
      );
    }
    const json = (await resp.json()) as { data?: Array<{ url?: string }> };
    const url = json.data?.[0]?.url;
    if (!url) {
      console.error("[ai-generate] no image url in response:", json);
      return NextResponse.json(
        { ok: false, error: "AI returned no image" },
        { status: 502 },
      );
    }
    imageUrl = url;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ai-generate] Doubao call failed:", msg);
    return NextResponse.json(
      { ok: false, error: "AI service unavailable" },
      { status: 502 },
    );
  }

  // 2. Download the upstream PNG/JPEG.
  let rawImage: Buffer;
  try {
    const imgResp = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
    if (!imgResp.ok) {
      console.error("[ai-generate] image download failed:", imgResp.status);
      return NextResponse.json(
        { ok: false, error: "AI image download failed" },
        { status: 502 },
      );
    }
    rawImage = Buffer.from(await imgResp.arrayBuffer());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ai-generate] image download threw:", msg);
    return NextResponse.json(
      { ok: false, error: "AI image download failed" },
      { status: 502 },
    );
  }

  // 3. Binarise for 300dpi 1-bit thermal. AI now generates freely so
  //    outputs can be photo-realistic / coloured / illustrated. Run
  //    the same Atkinson photo pipeline as user uploads — see
  //    lib/doodle/binarize.ts for the contrast / blur / dither recipe.
  let processedPng: Buffer;
  try {
    processedPng = await binarizeForThermal(rawImage, { mode: "atkinson" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ai-generate] preprocess failed:", msg);
    return NextResponse.json(
      { ok: false, error: "AI image processing failed" },
      { status: 500 },
    );
  }

  // 4. Upload + sign preview URL.
  let aiDoodleId: string;
  let previewUrl: string;
  try {
    const saved = await saveAiDoodleUpload({
      userId: user.userId,
      pngBuffer: processedPng,
    });
    aiDoodleId = saved.aiDoodleId;
    previewUrl = await aiDoodlePreviewUrl(user.userId, aiDoodleId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ai-generate] storage upload failed:", msg);
    return NextResponse.json(
      { ok: false, error: "Storage upload failed" },
      { status: 500 },
    );
  }

  console.log(
    `[ai-generate] ok userId=${user.userId} id=${aiDoodleId.slice(0, 8)} elapsed=${Date.now() - t0}ms`,
  );
  return NextResponse.json({ ok: true, aiDoodleId, previewUrl });
  } finally {
    aiInFlight.delete(user.userId);
  }
}
