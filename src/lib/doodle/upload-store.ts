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
