import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-server";

const BUCKET = "cup-label-gallery";

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

export function thumbUrlFor(p: Pick<GalleryPreset, "hash" | "source">): string {
  if (p.source === "builtin") return `/cup-label/gallery/${p.hash}/binarized.png`;
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

export { toPreset };
