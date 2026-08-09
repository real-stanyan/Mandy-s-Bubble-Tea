// src/lib/cup-label/client.ts
//
// Browser-side helpers for the cup-label Photo + AI sources. Wraps the
// existing /api/cup-label/upload-image and /api/cup-label/ai-submit
// routes so the LabelPicker doesn't speak fetch directly. Mirrors the
// shape of the RN app's `lib/doodle/{uploadImage.ts,aiGenerate.ts}`.

export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const AI_PROMPT_MAX_LEN = 200;

export class CupLabelClientError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "CupLabelClientError";
  }
}

export async function readFileAsDataUri(file: File): Promise<string> {
  // Use file.arrayBuffer() + chunked base64 instead of FileReader so the
  // test environment (vitest with environment: 'node') works without
  // jsdom/happy-dom. file.arrayBuffer() is standard on Blob since Node 18
  // and the Browser File API; btoa is global in both. Chunked
  // String.fromCharCode loop avoids "Maximum call stack size exceeded"
  // for large (8 MB) payloads.
  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch (err) {
    throw new CupLabelClientError(
      err instanceof Error ? `Failed to read file: ${err.message}` : "Failed to read file",
    );
  }
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const base64 = btoa(binary);
  const mime = file.type || "application/octet-stream";
  return `data:${mime};base64,${base64}`;
}

export interface UploadPhotoResult {
  uploadedDoodleId: string;
  previewUrl: string;
}

export async function uploadPhotoForCupLabel(file: File): Promise<UploadPhotoResult> {
  if (file.size > PHOTO_MAX_BYTES) {
    throw new CupLabelClientError(
      `Image too large (max ${PHOTO_MAX_BYTES / 1024 / 1024} MB)`,
    );
  }
  const dataUri = await readFileAsDataUri(file);
  const res = await fetch("/api/cup-label/upload-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64: dataUri }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    uploadedDoodleId?: string;
    previewUrl?: string;
    error?: string;
  };
  if (!res.ok || !body.ok || !body.uploadedDoodleId || !body.previewUrl) {
    throw new CupLabelClientError(body.error ?? `Upload failed (${res.status})`, res.status);
  }
  return {
    uploadedDoodleId: body.uploadedDoodleId,
    previewUrl: body.previewUrl,
  };
}

export interface AiSubmitArgs {
  slotKey: string;
  prompt: string;
  /** Curated style id ("memory-stamp"). Requires sourceImageBase64. */
  style?: string;
  sourceImageBase64?: string;
  cartSessionId: string;
}

export interface AiSubmitResult {
  aiDoodleId: string;
  status: "pending" | "ready" | "failed";
  reused: boolean;
}

export interface UploadDrawingResult {
  userDoodleId: string;
}

export async function uploadDrawingForCupLabel(
  paths: Array<{ d: string; stroke: string; width: number }>,
): Promise<UploadDrawingResult> {
  if (paths.length === 0) {
    throw new CupLabelClientError("Drawing is empty");
  }
  const res = await fetch("/api/doodle/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    doodleId?: string;
    error?: string;
  };
  if (!res.ok || !body.ok || !body.doodleId) {
    throw new CupLabelClientError(
      body.error ?? `Drawing upload failed (${res.status})`,
      res.status,
    );
  }
  return { userDoodleId: body.doodleId };
}

export async function submitAiCupLabel(args: AiSubmitArgs): Promise<AiSubmitResult> {
  const prompt = args.prompt.trim();
  if (prompt.length === 0) {
    throw new CupLabelClientError("Prompt is empty");
  }
  if (prompt.length > AI_PROMPT_MAX_LEN) {
    throw new CupLabelClientError(`Prompt too long (max ${AI_PROMPT_MAX_LEN} chars)`);
  }
  const body: Record<string, unknown> = {
    slotKey: args.slotKey,
    prompt,
    cartSessionId: args.cartSessionId,
  };
  if (args.style) body.style = args.style;
  if (args.sourceImageBase64) body.sourceImageBase64 = args.sourceImageBase64;
  const payload = JSON.stringify(body);
  // Vercel's platform body limit sits around 4.5 MB and answers with a bare
  // 413 before our route runs. Failing here instead gives the customer a
  // sentence they can act on, not a silently reverted cup.
  if (payload.length > 3_800_000) {
    throw new CupLabelClientError(
      "Photo is too large even after compression — please try a smaller image",
    );
  }
  const res = await fetch("/api/cup-label/ai-submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    aiDoodleId?: string;
    status?: AiSubmitResult["status"];
    reused?: boolean;
    error?: string;
  };
  if (!res.ok || !json.ok || !json.aiDoodleId) {
    throw new CupLabelClientError(json.error ?? `AI submit failed (${res.status})`, res.status);
  }
  return {
    aiDoodleId: json.aiDoodleId,
    status: json.status ?? "pending",
    reused: json.reused ?? false,
  };
}

/**
 * Shrink a reference image before it rides in a JSON body.
 *
 * The submit route accepts 8 MB, but it never gets to vote: Vercel rejects
 * request bodies around 4.5 MB at the platform layer, and a phone photo as
 * base64 (+33%) sails past that — the submit 413s, the catch handler clears
 * the slot, and the customer watches their stamp silently turn back into a
 * lucky cat (Stan, on production, 2026-08-09). Downscaling costs nothing:
 * the server resizes to 1024px for Doubao anyway.
 *
 * Browser-only (canvas). Returns the input untouched when decoding fails or
 * no DOM exists — the size backstop below still guards the payload.
 */
export async function downscaleDataUriForAi(
  dataUri: string,
  maxDim = 1280,
): Promise<string> {
  if (typeof document === "undefined") return dataUri;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new window.Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode failed"));
      el.src = dataUri;
    });
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    // Already small AND already a compact format — nothing to gain. A large
    // PNG still gets re-encoded to JPEG even at scale 1.
    if (scale === 1 && dataUri.startsWith("data:image/jpeg")) return dataUri;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUri;
    // White backing: JPEG has no alpha, and transparent PNG regions would
    // otherwise composite onto black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    return dataUri;
  }
}
