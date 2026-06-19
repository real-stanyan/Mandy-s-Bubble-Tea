// Idempotent seed of the 235 built-in presets into gallery_presets.
// Run ONCE against prod after the migration:  pnpm tsx scripts/seed-gallery-presets.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getSupabaseAdmin } from "../src/lib/supabase-server";

export type GalleryPresetSeedRow = {
  hash: string;
  source: "builtin";
  storage: "static";
  hidden: false;
  sort_order: number;
};

export function buildSeedRows(hashes: string[]): GalleryPresetSeedRow[] {
  return hashes.map((hash, i) => ({
    hash,
    source: "builtin",
    storage: "static",
    hidden: false,
    sort_order: i,
  }));
}

async function main() {
  const manifestPath = join(process.cwd(), "public", "cup-label", "gallery", "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { hashes: string[] };
  const rows = buildSeedRows(manifest.hashes);
  const sb = getSupabaseAdmin();
  const { error } = await sb.from("gallery_presets").upsert(rows, { onConflict: "hash" });
  if (error) throw new Error(error.message);
  console.log(`[seed-gallery] upserted ${rows.length} builtin presets`);
}

if (process.env.NODE_ENV !== "test") {
  main().catch((e) => {
    console.error("[seed-gallery] fatal:", e);
    process.exit(1);
  });
}
