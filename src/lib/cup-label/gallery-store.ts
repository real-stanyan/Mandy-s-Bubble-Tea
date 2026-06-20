import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { RARE_LUCKY_CAT_HASH } from "@/lib/cup-label/lucky-cat";

const BUCKET = "cup-label-gallery";
const LUCKY_CAT_DIR = path.join(process.cwd(), "public", "cup-label", "lucky-cat");

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
  p: Pick<GalleryPreset, "hash" | "source"> & { kind?: "gallery" | "lucky_cat" },
): string {
  if (p.source === "builtin") {
    // Built-in lucky-cats live under public/cup-label/lucky-cat/, gallery presets
    // under /gallery/. Pick the static dir by kind (defaults to gallery, which is
    // correct for the gallery-only customer read path that omits kind).
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
    .select("hash,source,storage,hidden,sort_order,deleted_at")
    .eq("kind", "gallery")
    .eq("hidden", false)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as DbRow[]).map((r) => ({ hash: r.hash, source: r.source, thumbUrl: thumbUrlFor(r) }));
}

export async function listAllForAdmin() {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("gallery_presets")
    .select("hash,source,storage,hidden,sort_order,deleted_at,kind")
    .is("deleted_at", null)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as (DbRow & { kind: "gallery" | "lucky_cat" })[]).map((r) => ({
    hash: r.hash, source: r.source, thumbUrl: thumbUrlFor(r), hidden: r.hidden, deletedAt: r.deleted_at, kind: r.kind,
  }));
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

export { toPreset };
