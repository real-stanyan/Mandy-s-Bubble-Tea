import "server-only";
import { randomUUID } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { validateSvgPaths } from "./render-svg";
import type { SvgPath } from "./render-svg";

export const MAX_PATHS = 200;

export type SaveUserDoodleArgs = { userId: string; paths: SvgPath[] };
export type SaveUserDoodleResult = { doodleId: string };

export async function saveUserDoodleUpload(
  args: SaveUserDoodleArgs,
): Promise<SaveUserDoodleResult> {
  if (!args.paths || args.paths.length === 0) {
    throw new Error("paths must contain at least one path");
  }
  if (args.paths.length > MAX_PATHS) {
    throw new Error(`paths has too many paths (max ${MAX_PATHS})`);
  }
  validateSvgPaths(args.paths);

  const doodleId = randomUUID();
  const sb = getSupabaseAdmin();
  const path = `${args.userId}/${doodleId}.json`;
  const body = Buffer.from(JSON.stringify({ paths: args.paths }), "utf8");
  const { error } = await sb.storage
    .from("doodles_pending")
    .upload(path, body, { contentType: "application/json", upsert: false });
  if (error) throw new Error(error.message);

  return { doodleId };
}

export async function loadUserDoodleUpload(
  userId: string,
  doodleId: string,
): Promise<SvgPath[]> {
  const sb = getSupabaseAdmin();
  const path = `${userId}/${doodleId}.json`;
  const { data, error } = await sb.storage.from("doodles_pending").download(path);
  if (error) throw new Error(`doodle ${doodleId} not found: ${error.message}`);
  const text = await data.text();
  const parsed = JSON.parse(text) as { paths: SvgPath[] };
  validateSvgPaths(parsed.paths);
  return parsed.paths;
}

// ─── AI doodles ───────────────────────────────────────────────────────────
// Parallel path for Doubao-generated doodles. We store the pre-processed PNG
// raster (already threshold-binarised, ready for ZPL ^GFA packing) so that
// every cup-label render reuses the same output without re-calling Doubao.
// Same bucket as drawn doodles, distinguished by `.png` extension under the
// `ai/` subfolder so quota/audit queries can filter by prefix.

export type SaveAiDoodleArgs = { userId: string; pngBuffer: Buffer };
export type SaveAiDoodleResult = { aiDoodleId: string };

export async function saveAiDoodleUpload(
  args: SaveAiDoodleArgs,
): Promise<SaveAiDoodleResult> {
  const aiDoodleId = randomUUID();
  const sb = getSupabaseAdmin();
  const path = `${args.userId}/ai/${aiDoodleId}.png`;
  const { error } = await sb.storage
    .from("doodles_pending")
    .upload(path, args.pngBuffer, { contentType: "image/png", upsert: false });
  if (error) throw new Error(error.message);
  return { aiDoodleId };
}

export async function loadAiDoodleUpload(
  userId: string,
  aiDoodleId: string,
): Promise<Buffer> {
  const sb = getSupabaseAdmin();
  const path = `${userId}/ai/${aiDoodleId}.png`;
  const { data, error } = await sb.storage.from("doodles_pending").download(path);
  if (error) throw new Error(`ai doodle ${aiDoodleId} not found: ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}

/** Short-lived signed preview URL (1h) so the app can show the user the result. */
export async function aiDoodlePreviewUrl(
  userId: string,
  aiDoodleId: string,
): Promise<string> {
  const sb = getSupabaseAdmin();
  const path = `${userId}/ai/${aiDoodleId}.png`;
  const { data, error } = await sb.storage
    .from("doodles_pending")
    .createSignedUrl(path, 60 * 60);
  if (error || !data) throw new Error(`failed to sign preview url: ${error?.message}`);
  return data.signedUrl;
}

/**
 * Upload a customer-supplied source image for Doubao image-to-image, get
 * back a short-lived signed URL Doubao can fetch. Source images are
 * ephemeral; we keep them in the same bucket as final doodles under
 * `ai-source/` so a future cleanup cron can wipe everything older than,
 * say, 1 day. For now they just accumulate — cheap enough.
 */
export async function saveAiSourceImage(
  userId: string,
  pngBuffer: Buffer,
): Promise<{ sourceId: string; signedUrl: string }> {
  const sourceId = randomUUID();
  const sb = getSupabaseAdmin();
  const path = `${userId}/ai-source/${sourceId}.png`;
  const { error: upErr } = await sb.storage
    .from("doodles_pending")
    .upload(path, pngBuffer, { contentType: "image/png", upsert: false });
  if (upErr) throw new Error(upErr.message);

  const { data, error } = await sb.storage
    .from("doodles_pending")
    .createSignedUrl(path, 60 * 60);
  if (error || !data) throw new Error(`failed to sign source url: ${error?.message}`);
  return { sourceId, signedUrl: data.signedUrl };
}
