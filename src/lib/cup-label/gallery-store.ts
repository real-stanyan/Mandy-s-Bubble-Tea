import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { RARE_LUCKY_CAT_HASH } from "@/lib/cup-label/lucky-cat";

const BUCKET = "cup-label-gallery";
const LUCKY_CAT_DIR = path.join(process.cwd(), "public", "cup-label", "lucky-cat");
const GALLERY_DIR = path.join(process.cwd(), "public", "cup-label", "gallery");

export type GalleryPreset = {
  hash: string;
  source: "builtin" | "upload";
  storage: "static" | "supabase";
  hidden: boolean;
  sortOrder: number;
  deletedAt: string | null;
};
export type VisiblePreset = { hash: string; source: "builtin" | "upload"; thumbUrl: string };

type DbRow = {
  hash: string; source: "builtin" | "upload"; storage: "static" | "supabase";
  hidden: boolean; sort_order: number; deleted_at: string | null;
};

export function thumbUrlFor(
  p: Pick<GalleryPreset, "hash" | "source"> & {
    kind?: "gallery" | "lucky_cat";
    hasOverride?: boolean;
  },
): string {
  if (p.source === "builtin") {
    // Re-processed built-in: canonical binarized.png lives in the bucket.
    if (p.hasOverride) {
      return getSupabaseAdmin().storage.from(BUCKET).getPublicUrl(`${p.hash}/binarized.png`).data.publicUrl;
    }
    const dir = p.kind === "lucky_cat" ? "lucky-cat" : "gallery";
    return `/cup-label/${dir}/${p.hash}/binarized.png`;
  }
  return getSupabaseAdmin().storage.from(BUCKET).getPublicUrl(`${p.hash}/color.png`).data.publicUrl;
}

function toPreset(r: DbRow): GalleryPreset {
  return { hash: r.hash, source: r.source, storage: r.storage, hidden: r.hidden, sortOrder: r.sort_order, deletedAt: r.deleted_at };
}

export async function listVisiblePresets(): Promise<VisiblePreset[]> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("gallery_presets")
    .select("hash,source,storage,hidden,sort_order,deleted_at,override_at")
    .eq("kind", "gallery")
    .eq("hidden", false)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as (DbRow & { override_at: string | null })[]).map((r) => ({
    hash: r.hash, source: r.source,
    thumbUrl: thumbUrlFor({ hash: r.hash, source: r.source, hasOverride: r.override_at != null }),
  }));
}

export async function listAllForAdmin() {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("gallery_presets")
    .select("hash,source,storage,hidden,sort_order,deleted_at,kind,override_at")
    .is("deleted_at", null)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as (DbRow & { kind: "gallery" | "lucky_cat"; override_at: string | null })[]).map((r) => {
    const hasOverride = r.override_at != null;
    return {
      hash: r.hash, source: r.source,
      thumbUrl: thumbUrlFor({ hash: r.hash, source: r.source, kind: r.kind, hasOverride }),
      hidden: r.hidden, deletedAt: r.deleted_at, kind: r.kind, hasOverride,
    };
  });
}

export async function insertUploadPreset(
  hash: string, createdBy: string, kind: "gallery" | "lucky_cat" = "gallery",
): Promise<void> {
  const sb = getSupabaseAdmin();
  const { error } = await sb.from("gallery_presets").upsert(
    { hash, source: "upload", storage: "supabase", kind, hidden: false, sort_order: -Date.now() % 2147483647, created_by: createdBy, deleted_at: null },
    { onConflict: "hash" },
  );
  if (error) throw new Error(error.message);
}

export async function setHidden(hash: string, hidden: boolean): Promise<void> {
  const sb = getSupabaseAdmin();
  const { error } = await sb.from("gallery_presets").update({ hidden }).eq("hash", hash);
  if (error) throw new Error(error.message);
}

export async function softDeletePreset(hash: string): Promise<{ ok: boolean; reason?: "not_found" }> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("gallery_presets").select("source").eq("hash", hash).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { ok: false, reason: "not_found" };
  const { error: upErr } = await sb.from("gallery_presets")
    .update({ hidden: true, deleted_at: new Date().toISOString() }).eq("hash", hash);
  if (upErr) throw new Error(upErr.message);
  return { ok: true };
}

export async function getPresetSource(hash: string): Promise<"builtin" | "upload" | null> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("gallery_presets").select("source").eq("hash", hash).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? (data as { source: "builtin" | "upload" }).source : null;
}

export async function downloadBucketBinarized(hash: string): Promise<Buffer> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.storage.from(BUCKET).download(`${hash}/binarized.png`);
  if (error || !data) throw new Error(error?.message ?? "download failed");
  return Buffer.from(await data.arrayBuffer());
}

export async function uploadBucketArtifacts(hash: string, colorPng: Buffer, binarizedPng: Buffer): Promise<void> {
  const sb = getSupabaseAdmin();
  for (const [name, buf] of [["color.png", colorPng], ["binarized.png", binarizedPng]] as const) {
    const { error } = await sb.storage.from(BUCKET).upload(`${hash}/${name}`, buf, { contentType: "image/png", upsert: true });
    if (error) throw new Error(`${name}: ${error.message}`);
  }
}

export function splitLuckyCatPool(hashes: string[]): { commons: string[]; hasRare: boolean } {
  return {
    commons: hashes.filter((h) => h !== RARE_LUCKY_CAT_HASH),
    hasRare: hashes.includes(RARE_LUCKY_CAT_HASH),
  };
}

export async function listLuckyCatPoolHashes(): Promise<{ commons: string[]; hasRare: boolean }> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("gallery_presets")
    .select("hash")
    .eq("kind", "lucky_cat")
    .eq("hidden", false)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
  return splitLuckyCatPool((data as { hash: string }[]).map((r) => r.hash));
}

export async function getLuckyCatBinarized(hash: string): Promise<Buffer> {
  try {
    return await fs.readFile(path.join(LUCKY_CAT_DIR, hash, "binarized.png"));
  } catch {
    return downloadBucketBinarized(hash);
  }
}

export async function loadSourceColor(hash: string): Promise<Buffer | null> {
  const sb = getSupabaseAdmin();
  const { data: row } = await sb.from("gallery_presets").select("source,kind").eq("hash", hash).maybeSingle();
  const r = row as { source: "builtin" | "upload"; kind: "gallery" | "lucky_cat" } | null;
  // Built-in gallery presets keep their color source on disk.
  if (r?.source === "builtin" && r.kind === "gallery") {
    try { return await fs.readFile(path.join(GALLERY_DIR, hash, "color.png")); } catch { /* fall through */ }
  }
  // Uploads (and re-uploaded built-ins) keep color in the bucket.
  const { data, error } = await sb.storage.from(BUCKET).download(`${hash}/color.png`);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

export async function setOverride(hash: string): Promise<void> {
  const sb = getSupabaseAdmin();
  const { error } = await sb.from("gallery_presets").update({ override_at: new Date().toISOString() }).eq("hash", hash);
  if (error) throw new Error(error.message);
}

export async function clearOverride(hash: string): Promise<{ ok: boolean; reason?: "not_found" }> {
  const sb = getSupabaseAdmin();
  const { data } = await sb.from("gallery_presets").select("source").eq("hash", hash).maybeSingle();
  if (!data) return { ok: false, reason: "not_found" };
  const { error } = await sb.from("gallery_presets").update({ override_at: null }).eq("hash", hash);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function listPresetOverrides(hashes: string[]): Promise<Set<string>> {
  if (hashes.length === 0) return new Set();
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("gallery_presets")
    .select("hash")
    .not("override_at", "is", null)
    .in("hash", hashes);
  if (error) throw new Error(error.message);
  return new Set((data as { hash: string }[]).map((r) => r.hash));
}

export { toPreset };
