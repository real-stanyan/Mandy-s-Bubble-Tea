// Idempotent seed of the built-in lucky-cat deck into gallery_presets (kind=lucky_cat).
// Run ONCE against prod after the migration:  pnpm tsx scripts/seed-lucky-cat-presets.ts
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { getSupabaseAdmin } from "../src/lib/supabase-server";

const HASH_RE = /^[a-f0-9]{32}$/;

export type LuckyCatSeedRow = {
  hash: string;
  source: "builtin";
  storage: "static";
  kind: "lucky_cat";
  hidden: false;
  sort_order: number;
};

export function buildLuckyCatSeedRows(hashes: string[]): LuckyCatSeedRow[] {
  return hashes.map((hash, i) => ({
    hash, source: "builtin", storage: "static", kind: "lucky_cat", hidden: false, sort_order: i,
  }));
}

async function main() {
  const dir = join(process.cwd(), "public", "cup-label", "lucky-cat");
  const entries = await readdir(dir, { withFileTypes: true });
  const hashes = entries.filter((e) => e.isDirectory() && HASH_RE.test(e.name)).map((e) => e.name).sort();
  const rows = buildLuckyCatSeedRows(hashes);
  const { error } = await getSupabaseAdmin().from("gallery_presets").upsert(rows, { onConflict: "hash" });
  if (error) throw new Error(error.message);
  console.log(`[seed-lucky-cat] upserted ${rows.length} lucky-cat presets`);
}

if (process.env.NODE_ENV !== "test") {
  main().catch((e) => { console.error("[seed-lucky-cat] fatal:", e); process.exit(1); });
}
