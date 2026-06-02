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
  if (args.sourceImageBase64) body.sourceImageBase64 = args.sourceImageBase64;
  const res = await fetch("/api/cup-label/ai-submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
