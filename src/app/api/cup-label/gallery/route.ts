import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { listVisiblePresets } from "@/lib/cup-label/gallery-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const presets = await listVisiblePresets();
    return NextResponse.json({ ok: true, presets });
  } catch (e) {
    console.error(
      "[cup-label/gallery] db read failed, falling back to static manifest:",
      e instanceof Error ? e.message : e
    );
    try {
      const raw = await readFile(
        join(process.cwd(), "public", "cup-label", "gallery", "manifest.json"),
        "utf8"
      );
      const { hashes } = JSON.parse(raw) as { hashes: string[] };
      const presets = hashes.map((hash) => ({
        hash,
        source: "builtin" as const,
        thumbUrl: `/cup-label/gallery/${hash}/binarized.png`,
      }));
      return NextResponse.json({ ok: true, presets, degraded: true });
    } catch {
      return NextResponse.json({ ok: true, presets: [] });
    }
  }
}
