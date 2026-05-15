import "server-only";
import sharp from "sharp";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { saveAiSourceImage } from "@/lib/doodle/upload-store";
import { binarizeForThermal } from "@/lib/doodle/binarize";

// Background processor for one row of cup_label_ai_jobs. Owns the
// full Doubao → binarize → Storage pipeline. Called from
// /api/cup-label/ai-submit via Vercel waitUntil so the customer's
// HTTP response returns immediately and the AI work happens after.
//
// Always mutates the row to a terminal state ('ready' or 'failed').
// Never throws to its caller — waitUntil rejections are silently
// dropped on Vercel and we want the row state to be the source of
// truth.

const DOUBAO_ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3/images/generations";
const DOUBAO_MODEL = "doubao-seedream-4-5-251128";
const DOUBAO_TIMEOUT_MS = 50_000;
const IMAGE_DL_TIMEOUT_MS = 15_000;

export type ProcessAiJobInput = {
  jobId: string;
  userId: string;
  prompt: string;
  /** Optional reference image (raw decoded buffer) for image-to-image. */
  sourceImage?: Buffer;
};

export async function processAiJob(input: ProcessAiJobInput): Promise<void> {
  const t0 = Date.now();
  try {
    const pngPath = await runPipeline(input);
    await markReady(input.jobId, pngPath);
    console.log(
      `[ai-process] ready job=${input.jobId.slice(0, 8)} user=${input.userId} elapsed=${Date.now() - t0}ms`,
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await markFailed(input.jobId, message);
    console.error(`[ai-process] failed job=${input.jobId.slice(0, 8)}: ${message}`);
  }
}

async function runPipeline(input: ProcessAiJobInput): Promise<string> {
  const apiKey = process.env.ARK_API_KEY;
  if (!apiKey) throw new Error("ARK_API_KEY not set");

  // 0. Upload source image to Storage + sign URL so Doubao can fetch.
  let sourceSignedUrl: string | undefined;
  if (input.sourceImage && input.sourceImage.length > 0) {
    const pngSrc = await sharp(input.sourceImage)
      .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const saved = await saveAiSourceImage(input.userId, pngSrc);
    sourceSignedUrl = saved.signedUrl;
  }

  // 1. Generate via Doubao.
  const body: Record<string, unknown> = {
    model: DOUBAO_MODEL,
    prompt: input.prompt,
    sequential_image_generation: "disabled",
    response_format: "url",
    size: "2048x2048",
    stream: false,
    watermark: false,
  };
  if (sourceSignedUrl) body.image = sourceSignedUrl;

  const resp = await fetch(DOUBAO_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(DOUBAO_TIMEOUT_MS),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Doubao HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  const json = (await resp.json()) as { data?: Array<{ url?: string }> };
  const imageUrl = json.data?.[0]?.url;
  if (!imageUrl) throw new Error("Doubao returned no image URL");

  // 2. Download upstream image.
  const imgResp = await fetch(imageUrl, { signal: AbortSignal.timeout(IMAGE_DL_TIMEOUT_MS) });
  if (!imgResp.ok) throw new Error(`image download HTTP ${imgResp.status}`);
  const rawImage = Buffer.from(await imgResp.arrayBuffer());

  // 2b. Persist the color original for the admin cup-doodles gallery
  // BEFORE binarizing. Stored as PNG under {userId}/ai-originals/{jobId}.png
  // so the doodles_pending bucket's mime allowlist accepts it. Failure
  // here is non-fatal — the print path doesn't depend on the original,
  // so we log and continue rather than fail the whole submission.
  const originalPath = `${input.userId}/ai-originals/${input.jobId}.png`;
  try {
    const colorPng = await sharp(rawImage).png({ compressionLevel: 6 }).toBuffer();
    const sbStore = getSupabaseAdmin();
    const { error } = await sbStore.storage
      .from("doodles_pending")
      .upload(originalPath, colorPng, { contentType: "image/png", upsert: true });
    if (error) {
      console.warn(`[ai-process] color-original upload failed (non-fatal): ${error.message}`);
    } else {
      await sbStore
        .from("cup_label_ai_jobs")
        .update({ original_png_path: originalPath })
        .eq("id", input.jobId);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[ai-process] color-original step threw (non-fatal): ${msg}`);
  }

  // 3. Binarize for 300dpi thermal.
  const processedPng = await binarizeForThermal(rawImage, { mode: "atkinson" });

  // 4. Save to Storage — same path scheme as legacy saveAiDoodleUpload,
  //    but the path key is the jobId (== aiDoodleId surfaced to clients)
  //    rather than a fresh uuid, so the row's `png_path` and the
  //    customer-facing `aiDoodleId` agree.
  const pngPath = `${input.userId}/ai/${input.jobId}.png`;
  const sb = getSupabaseAdmin();
  const { error } = await sb.storage
    .from("doodles_pending")
    .upload(pngPath, processedPng, { contentType: "image/png", upsert: true });
  if (error) throw new Error(`storage upload failed: ${error.message}`);
  return pngPath;
}

async function markReady(jobId: string, pngPath: string): Promise<void> {
  const sb = getSupabaseAdmin();
  const { error } = await sb
    .from("cup_label_ai_jobs")
    .update({
      status: "ready",
      png_path: pngPath,
      ready_at: new Date().toISOString(),
    })
    .eq("id", jobId);
  if (error) console.error(`[ai-process] markReady ${jobId} failed:`, error.message);
}

async function markFailed(jobId: string, message: string): Promise<void> {
  const sb = getSupabaseAdmin();
  const { error } = await sb
    .from("cup_label_ai_jobs")
    .update({
      status: "failed",
      error: message.slice(0, 500),
      ready_at: new Date().toISOString(),
    })
    .eq("id", jobId);
  if (error) console.error(`[ai-process] markFailed ${jobId} failed:`, error.message);
}
