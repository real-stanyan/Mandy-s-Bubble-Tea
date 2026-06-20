# Cup-Label Gallery Admin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give staff an admin page that shows every default cup-label preset and lets them batch-upload new designs that go live to web + app immediately.

**Architecture:** Move the gallery's source of truth from static `public/` PNGs to Supabase (`gallery_presets` table + `cup-label-gallery` bucket, seeded with the 235 built-ins). Web owns all processing/merge/print; the admin app is a thin UI that calls web's staff-token API server-to-server. Web `LabelPicker`/`enqueue` and the RN app consume a single merged read endpoint at runtime.

**Tech Stack:** Next.js (web + admin, App Router, `runtime = "nodejs"`), `sharp` + `binarizeForThermal` (Atkinson dither), Supabase JS (service-role), React Native (Expo) for the app, Vitest (web/admin) + Jest (app).

## Global Constraints

- Web repo lives on branch `feat/cup-label-gallery-admin` off `origin/main` (`ec8e74dd`), in worktree `.claude/worktrees/gallery-admin/`. **Do NOT touch the `re-design` branch/tree.**
- Print image is **592×592 1-bit PNG** produced ONLY by `binarizeForThermal(raw, { mode: "atkinson" })` from `@/lib/doodle/binarize` — never reimplement dithering.
- Color thumbnail = `sharp(raw).resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true }).png({ compressionLevel: 9, adaptiveFiltering: true })` (matches `upload-image/route.ts:124-127`); served downscale target 480px width is acceptable but keep one consistent size — use 480px for the bucket `color.png`.
- Hash = lowercase MD5 hex of the **raw uploaded bytes** (32 chars). Validate against `/^[a-f0-9]{32}$/` server-side.
- Preset hash accepted from clients must still pass the existing guard: `length <= 64` and `/^[A-Za-z0-9_-]{1,64}$/` (`enqueue.ts:57-58`).
- Supabase admin client: `getSupabaseAdmin()` from `@/lib/supabase-server` (web) / `@/lib/supabase-server` (admin). Server-only; never expose service-role to client.
- Staff-token: a new env var `GALLERY_ADMIN_TOKEN` (web + admin). Admin reads web base URL from existing `NEXT_PUBLIC_WEB_ORIGIN` (default `https://mandybubbletea.com`, see admin `src/lib/cup-doodles.ts:18-19`).
- Money/Square unaffected — this feature touches no payment code.
- Supabase migration + seed apply to **prod before** the code deploy (additive table + bucket; follows prod-migration-ahead-of-deploy rule).
- Commit after every task. Run `npx vitest run <file>` (web/admin) / `pnpm jest <file>` (app) for the touched test only during steps; full suite before the task's final commit.

---

## File Structure

**Supabase**
- Create: `supabase/migrations/2026-06-19-gallery-presets.sql` (table + bucket + policies)
- Create: `scripts/seed-gallery-presets.ts` (idempotent upsert of 235 built-ins from manifest.json)

**Web (`mandys_bubble_tea`)**
- Create: `src/lib/cup-label/gallery-process.ts` — raw → `{ hash, colorPng, binarizedPng }`
- Create: `src/lib/cup-label/gallery-store.ts` — Supabase CRUD + merge/list/download helpers
- Create: `src/lib/cup-label/gallery-admin-auth.ts` — `GALLERY_ADMIN_TOKEN` guard
- Create: `src/app/api/admin/gallery/preview/route.ts`
- Create: `src/app/api/admin/gallery/commit/route.ts`
- Create: `src/app/api/admin/gallery/route.ts` (GET list-all-for-admin)
- Create: `src/app/api/admin/gallery/[hash]/route.ts` (PATCH hide, DELETE soft-delete)
- Create: `src/app/api/cup-label/gallery/route.ts` (GET public merged)
- Modify: `src/components/checkout/LabelPicker.tsx:25,59-67,203-237` (consume merged endpoint)
- Modify: `src/lib/cup-label/enqueue.ts:381-399` (dual-source preset resolution)

**Admin (`mandys_bubble_tea_admin`)**
- Create: `src/lib/gallery.ts` — server-side caller of web admin API (staff token)
- Create: `src/app/gallery/page.tsx` — server page (auth + initial list)
- Create: `src/app/gallery/GalleryGrid.tsx` — client (grid, batch upload, preview, hide/delete)
- Modify: `src/components/shell/Sidebar.tsx` + `src/components/shell/BottomTabBar.tsx` (nav entry)

**App (`mandys_bubble_tea_app`)**
- Create: `lib/doodle/gallery-remote.ts` — runtime fetch of merged gallery + builtin/remote source resolver
- Modify: `components/doodle/DoodleModal.tsx:23,319` (render merged list)

---

## Task 1: Supabase migration + seed (table, bucket, 235 built-ins)

**Files:**
- Create: `supabase/migrations/2026-06-19-gallery-presets.sql`
- Create: `scripts/seed-gallery-presets.ts`
- Test: `scripts/seed-gallery-presets.test.ts`

**Interfaces:**
- Produces: table `gallery_presets(hash text pk, source text, storage text, hidden bool, sort_order int, created_at timestamptz, created_by text, deleted_at timestamptz)`; public bucket `cup-label-gallery`. Seed script exports `buildSeedRows(hashes: string[]): GalleryPresetSeedRow[]`.

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/2026-06-19-gallery-presets.sql`:

```sql
-- Cup-label preset gallery: source of truth for default + admin-uploaded stickers.
create table if not exists public.gallery_presets (
  hash        text primary key,
  source      text not null check (source in ('builtin','upload')),
  storage     text not null check (storage in ('static','supabase')),
  hidden      boolean not null default false,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  created_by  text,
  deleted_at  timestamptz,
  constraint gallery_presets_source_storage check (
    (source = 'builtin' and storage = 'static') or
    (source = 'upload'  and storage = 'supabase')
  )
);

create index if not exists gallery_presets_visible_idx
  on public.gallery_presets (sort_order)
  where hidden = false and deleted_at is null;

-- Public-read bucket for admin-uploaded presets ({hash}/color.png, {hash}/binarized.png).
insert into storage.buckets (id, name, public)
values ('cup-label-gallery', 'cup-label-gallery', true)
on conflict (id) do nothing;
```

- [ ] **Step 2: Write the seed helper test**

Create `scripts/seed-gallery-presets.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildSeedRows } from "./seed-gallery-presets";

describe("buildSeedRows", () => {
  it("maps hashes to builtin/static rows with ascending sort_order", () => {
    const rows = buildSeedRows(["aaa", "bbb"]);
    expect(rows).toEqual([
      { hash: "aaa", source: "builtin", storage: "static", hidden: false, sort_order: 0 },
      { hash: "bbb", source: "builtin", storage: "static", hidden: false, sort_order: 1 },
    ]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run scripts/seed-gallery-presets.test.ts`
Expected: FAIL — cannot find module `./seed-gallery-presets`.

- [ ] **Step 4: Write the seed script**

Create `scripts/seed-gallery-presets.ts`:

```ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run scripts/seed-gallery-presets.test.ts`
Expected: PASS.

- [ ] **Step 6: Apply migration + seed to prod, then commit**

Apply the migration SQL and run the seed against prod Supabase (Management API / `pnpm tsx scripts/seed-gallery-presets.ts` with prod env). Verify: `select count(*) from gallery_presets;` → 235; `select * from storage.buckets where id='cup-label-gallery';` → 1 row, public=true.

```bash
git add supabase/migrations/2026-06-19-gallery-presets.sql scripts/seed-gallery-presets.ts scripts/seed-gallery-presets.test.ts
git commit -m "feat(gallery): gallery_presets table + bucket + 235 builtin seed"
```

---

## Task 2: Gallery image processing helper

**Files:**
- Create: `src/lib/cup-label/gallery-process.ts`
- Test: `src/lib/cup-label/gallery-process.test.ts`

**Interfaces:**
- Consumes: `binarizeForThermal` from `@/lib/doodle/binarize`; `sharp`.
- Produces: `processGalleryImage(raw: Buffer): Promise<{ hash: string; colorPng: Buffer; binarizedPng: Buffer }>` and `md5Hex(buf: Buffer): string`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/cup-label/gallery-process.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { processGalleryImage, md5Hex } from "./gallery-process";

async function redSquare(): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 220, g: 30, b: 30 } } })
    .png().toBuffer();
}

describe("gallery-process", () => {
  it("md5Hex is 32 lowercase hex chars", () => {
    expect(md5Hex(Buffer.from("x"))).toMatch(/^[a-f0-9]{32}$/);
  });

  it("processGalleryImage yields hash + 592x592 1-bit binarized + color png", async () => {
    const raw = await redSquare();
    const out = await processGalleryImage(raw);
    expect(out.hash).toBe(md5Hex(raw));
    const binMeta = await sharp(out.binarizedPng).metadata();
    expect(binMeta.width).toBe(592);
    expect(binMeta.height).toBe(592);
    const colorMeta = await sharp(out.colorPng).metadata();
    expect(colorMeta.format).toBe("png");
    expect(colorMeta.width).toBeLessThanOrEqual(480);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/cup-label/gallery-process.test.ts`
Expected: FAIL — cannot find module `./gallery-process`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/cup-label/gallery-process.ts`:

```ts
import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { binarizeForThermal } from "@/lib/doodle/binarize";

export function md5Hex(buf: Buffer): string {
  return createHash("md5").update(buf).digest("hex");
}

/**
 * Raw uploaded image → the two artifacts the gallery stores:
 *   binarizedPng — 592×592 1-bit, the ZD410 print image (same pipeline as
 *                  customer photo uploads / the static 235).
 *   colorPng     — 480px-wide color thumbnail for the picker.
 * hash = md5 of the raw bytes (content-addressed, matches the static scheme).
 */
export async function processGalleryImage(
  raw: Buffer,
): Promise<{ hash: string; colorPng: Buffer; binarizedPng: Buffer }> {
  const hash = md5Hex(raw);
  const binarizedPng = await binarizeForThermal(raw, { mode: "atkinson" });
  const colorPng = await sharp(raw)
    .resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  return { hash, colorPng, binarizedPng };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/cup-label/gallery-process.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cup-label/gallery-process.ts src/lib/cup-label/gallery-process.test.ts
git commit -m "feat(gallery): raw→hash/binarized/color processing helper"
```

---

## Task 3: Gallery store (Supabase CRUD + merge/list/download)

**Files:**
- Create: `src/lib/cup-label/gallery-store.ts`
- Test: `src/lib/cup-label/gallery-store.test.ts`

**Interfaces:**
- Consumes: `getSupabaseAdmin` from `@/lib/supabase-server`.
- Produces:
  - `type GalleryPreset = { hash: string; source: "builtin" | "upload"; storage: "static" | "supabase"; hidden: boolean; sortOrder: number; deletedAt: string | null }`
  - `type VisiblePreset = { hash: string; source: "builtin" | "upload"; thumbUrl: string }`
  - `listVisiblePresets(): Promise<VisiblePreset[]>`
  - `listAllForAdmin(): Promise<(VisiblePreset & { hidden: boolean; deletedAt: string | null })[]>`
  - `insertUploadPreset(hash: string, createdBy: string): Promise<void>`
  - `setHidden(hash: string, hidden: boolean): Promise<void>`
  - `softDeleteUpload(hash: string): Promise<{ ok: boolean; reason?: string }>`
  - `getPresetSource(hash: string): Promise<"builtin" | "upload" | null>`
  - `bucketColorUrl(hash: string): string` / `bucketBinarizedPath(hash: string): string`
  - `WEB_ORIGIN: string` (re-exported base for builtin thumbUrl building) — builtin thumbUrl is the site-relative path `"/cup-label/gallery/${hash}/binarized.png"`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/cup-label/gallery-store.test.ts` (mock `@/lib/supabase-server`):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const rows: any[] = [];
const sb = {
  from: () => ({
    select: () => ({
      order: () => ({ then: (r: any) => r({ data: rows.filter((x) => !x.hidden && !x.deleted_at), error: null }) }),
    }),
    upsert: vi.fn(async () => ({ error: null })),
    update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
  }),
  storage: { from: () => ({ getPublicUrl: (p: string) => ({ data: { publicUrl: `https://cdn/${p}` } }) }) },
};
vi.mock("@/lib/supabase-server", () => ({ getSupabaseAdmin: () => sb }));

import { thumbUrlFor } from "./gallery-store";

beforeEach(() => { rows.length = 0; });

describe("gallery-store thumbUrlFor", () => {
  it("builtin → static site-relative path", () => {
    expect(thumbUrlFor({ hash: "h1", source: "builtin", storage: "static" } as any))
      .toBe("/cup-label/gallery/h1/binarized.png");
  });
  it("upload → bucket public color url", () => {
    expect(thumbUrlFor({ hash: "h2", source: "upload", storage: "supabase" } as any))
      .toBe("https://cdn/h2/color.png");
  });
});
```

> Note: the real Supabase query builder is awaited differently; the implementation below uses `await sb.from(...).select(...)`. Keep `thumbUrlFor` a **pure function** so it is unit-testable without the network. Test list/insert/hide against the prod DB manually in Task 8 smoke + admin chrome-devtools, or with the Supabase test harness already used in `cup-doodles.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/cup-label/gallery-store.test.ts`
Expected: FAIL — cannot find module `./gallery-store`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/cup-label/gallery-store.ts`:

```ts
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
    .select("hash,source,storage,hidden,sort_order,deleted_at")
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as DbRow[]).map((r) => ({
    hash: r.hash, source: r.source, thumbUrl: thumbUrlFor(r), hidden: r.hidden, deletedAt: r.deleted_at,
  }));
}

export async function insertUploadPreset(hash: string, createdBy: string): Promise<void> {
  const sb = getSupabaseAdmin();
  const { error } = await sb.from("gallery_presets").upsert(
    { hash, source: "upload", storage: "supabase", hidden: false, sort_order: -Date.now() % 2147483647, created_by: createdBy, deleted_at: null },
    { onConflict: "hash" },
  );
  if (error) throw new Error(error.message);
}

export async function setHidden(hash: string, hidden: boolean): Promise<void> {
  const sb = getSupabaseAdmin();
  const { error } = await sb.from("gallery_presets").update({ hidden }).eq("hash", hash);
  if (error) throw new Error(error.message);
}

export async function softDeleteUpload(hash: string): Promise<{ ok: boolean; reason?: string }> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from("gallery_presets").select("source").eq("hash", hash).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { ok: false, reason: "not_found" };
  if ((data as { source: string }).source === "builtin") return { ok: false, reason: "builtin_not_deletable" };
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/cup-label/gallery-store.test.ts`
Expected: PASS (`thumbUrlFor` pure-function cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/cup-label/gallery-store.ts src/lib/cup-label/gallery-store.test.ts
git commit -m "feat(gallery): supabase store (list/insert/hide/soft-delete/download)"
```

---

## Task 4: Staff-token auth guard

**Files:**
- Create: `src/lib/cup-label/gallery-admin-auth.ts`
- Test: `src/lib/cup-label/gallery-admin-auth.test.ts`

**Interfaces:**
- Produces: `isAuthedGalleryAdmin(request: Request): { ok: true } | { ok: false; reason: "unauthorized" | "unconfigured" }`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { isAuthedGalleryAdmin } from "./gallery-admin-auth";

function req(token?: string) {
  return new Request("http://x", token ? { headers: { authorization: `Bearer ${token}` } } : {});
}
afterEach(() => { delete process.env.GALLERY_ADMIN_TOKEN; });

describe("isAuthedGalleryAdmin", () => {
  it("unconfigured when env missing", () => {
    expect(isAuthedGalleryAdmin(req("x"))).toEqual({ ok: false, reason: "unconfigured" });
  });
  it("ok with matching bearer token", () => {
    process.env.GALLERY_ADMIN_TOKEN = "secret";
    expect(isAuthedGalleryAdmin(req("secret"))).toEqual({ ok: true });
  });
  it("unauthorized with wrong token", () => {
    process.env.GALLERY_ADMIN_TOKEN = "secret";
    expect(isAuthedGalleryAdmin(req("nope"))).toEqual({ ok: false, reason: "unauthorized" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/cup-label/gallery-admin-auth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
import "server-only";

export function isAuthedGalleryAdmin(
  request: Request,
): { ok: true } | { ok: false; reason: "unauthorized" | "unconfigured" } {
  const expected = process.env.GALLERY_ADMIN_TOKEN;
  if (!expected) return { ok: false, reason: "unconfigured" };
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token && token === expected) return { ok: true };
  return { ok: false, reason: "unauthorized" };
}
```

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run src/lib/cup-label/gallery-admin-auth.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cup-label/gallery-admin-auth.ts src/lib/cup-label/gallery-admin-auth.test.ts
git commit -m "feat(gallery): GALLERY_ADMIN_TOKEN staff-token guard"
```

---

## Task 5: `POST /api/admin/gallery/preview`

**Files:**
- Create: `src/app/api/admin/gallery/preview/route.ts`
- Test: `src/app/api/admin/gallery/preview/route.test.ts`

**Interfaces:**
- Consumes: `isAuthedGalleryAdmin`, `processGalleryImage`.
- Request body: `{ images: string[] }` (each data-URI or raw base64). Produces JSON `{ ok: true, results: Array<{ hash: string; colorDataUrl: string; binarizedDataUrl: string }> | { error: string }> }`. Returns 401/500 on auth failure.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
vi.mock("@/lib/cup-label/gallery-admin-auth", () => ({ isAuthedGalleryAdmin: () => ({ ok: true }) }));
import sharp from "sharp";
import { POST } from "./route";

async function redB64() {
  const buf = await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 200, g: 20, b: 20 } } }).png().toBuffer();
  return `data:image/png;base64,${buf.toString("base64")}`;
}

beforeEach(() => { process.env.GALLERY_ADMIN_TOKEN = "t"; });

describe("POST preview", () => {
  it("returns hash + data URLs per image without persisting", async () => {
    const body = JSON.stringify({ images: [await redB64()] });
    const res = await POST(new Request("http://x/api/admin/gallery/preview", { method: "POST", body }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.results[0].hash).toMatch(/^[a-f0-9]{32}$/);
    expect(json.results[0].binarizedDataUrl).toContain("data:image/png;base64,");
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx vitest run src/app/api/admin/gallery/preview/route.test.ts` → FAIL (no route).

- [ ] **Step 3: Write the implementation**

```ts
import { NextResponse } from "next/server";
import { isAuthedGalleryAdmin } from "@/lib/cup-label/gallery-admin-auth";
import { processGalleryImage } from "@/lib/cup-label/gallery-process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_IMAGES = 30;

function decode(input: string): Buffer {
  const m = input.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  return Buffer.from(m ? m[1] : input, "base64");
}

export async function POST(request: Request) {
  const auth = isAuthedGalleryAdmin(request);
  if (!auth.ok) return NextResponse.json({ ok: false, reason: auth.reason }, { status: auth.reason === "unconfigured" ? 500 : 401 });

  const body = (await request.json().catch(() => null)) as { images?: unknown } | null;
  const images = Array.isArray(body?.images) ? (body!.images as unknown[]) : null;
  if (!images || images.length === 0) return NextResponse.json({ ok: false, error: "images required" }, { status: 400 });
  if (images.length > MAX_IMAGES) return NextResponse.json({ ok: false, error: `max ${MAX_IMAGES} images` }, { status: 413 });

  const results = await Promise.all(images.map(async (img) => {
    try {
      if (typeof img !== "string") return { error: "not a string" };
      const raw = decode(img);
      if (raw.length === 0) return { error: "empty image" };
      if (raw.length > MAX_BYTES) return { error: "image too large" };
      const { hash, colorPng, binarizedPng } = await processGalleryImage(raw);
      return {
        hash,
        colorDataUrl: `data:image/png;base64,${colorPng.toString("base64")}`,
        binarizedDataUrl: `data:image/png;base64,${binarizedPng.toString("base64")}`,
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "processing failed" };
    }
  }));

  return NextResponse.json({ ok: true, results });
}
```

- [ ] **Step 4: Run test to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/gallery/preview
git commit -m "feat(gallery): admin preview endpoint (raw→binarized, no persist)"
```

---

## Task 6: `POST /api/admin/gallery/commit`

**Files:**
- Create: `src/app/api/admin/gallery/commit/route.ts`
- Test: `src/app/api/admin/gallery/commit/route.test.ts`

**Interfaces:**
- Consumes: `isAuthedGalleryAdmin`, `processGalleryImage`, `uploadBucketArtifacts`, `insertUploadPreset`.
- Request: `{ images: Array<{ image: string; hash: string }>, createdBy?: string }`. Server re-derives from raw; rejects if recomputed hash ≠ claimed hash. Produces `{ ok, committed: string[], failed: Array<{ hash: string; error: string }> }`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
vi.mock("@/lib/cup-label/gallery-admin-auth", () => ({ isAuthedGalleryAdmin: () => ({ ok: true }) }));
const uploads: string[] = [];
const inserts: string[] = [];
vi.mock("@/lib/cup-label/gallery-store", () => ({
  uploadBucketArtifacts: async (h: string) => { uploads.push(h); },
  insertUploadPreset: async (h: string) => { inserts.push(h); },
}));
import sharp from "sharp";
import { createHash } from "node:crypto";
import { POST } from "./route";

beforeEach(() => { process.env.GALLERY_ADMIN_TOKEN = "t"; uploads.length = 0; inserts.length = 0; });

async function img() {
  const buf = await sharp({ create: { width: 24, height: 24, channels: 3, background: { r: 10, g: 200, b: 50 } } }).png().toBuffer();
  return { image: `data:image/png;base64,${buf.toString("base64")}`, hash: createHash("md5").update(buf).digest("hex") };
}

describe("POST commit", () => {
  it("commits when claimed hash matches recomputed", async () => {
    const body = JSON.stringify({ images: [await img()] });
    const res = await POST(new Request("http://x", { method: "POST", body }));
    const json = await res.json();
    expect(json.committed).toHaveLength(1);
    expect(uploads).toHaveLength(1);
    expect(inserts).toHaveLength(1);
  });
  it("rejects hash mismatch", async () => {
    const one = await img();
    const body = JSON.stringify({ images: [{ image: one.image, hash: "deadbeef".repeat(4) }] });
    const res = await POST(new Request("http://x", { method: "POST", body }));
    const json = await res.json();
    expect(json.committed).toHaveLength(0);
    expect(json.failed[0].error).toContain("hash mismatch");
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL (no route).

- [ ] **Step 3: Write the implementation**

```ts
import { NextResponse } from "next/server";
import { isAuthedGalleryAdmin } from "@/lib/cup-label/gallery-admin-auth";
import { processGalleryImage } from "@/lib/cup-label/gallery-process";
import { uploadBucketArtifacts, insertUploadPreset } from "@/lib/cup-label/gallery-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function decode(input: string): Buffer {
  const m = input.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  return Buffer.from(m ? m[1] : input, "base64");
}

export async function POST(request: Request) {
  const auth = isAuthedGalleryAdmin(request);
  if (!auth.ok) return NextResponse.json({ ok: false, reason: auth.reason }, { status: auth.reason === "unconfigured" ? 500 : 401 });

  const body = (await request.json().catch(() => null)) as { images?: Array<{ image: string; hash: string }>; createdBy?: string } | null;
  const images = Array.isArray(body?.images) ? body!.images : null;
  if (!images || images.length === 0) return NextResponse.json({ ok: false, error: "images required" }, { status: 400 });
  const createdBy = typeof body?.createdBy === "string" ? body.createdBy : "admin";

  const committed: string[] = [];
  const failed: Array<{ hash: string; error: string }> = [];
  for (const item of images) {
    try {
      const { hash, colorPng, binarizedPng } = await processGalleryImage(decode(item.image));
      if (hash !== item.hash) { failed.push({ hash: item.hash, error: "hash mismatch" }); continue; }
      await uploadBucketArtifacts(hash, colorPng, binarizedPng);
      await insertUploadPreset(hash, createdBy);
      committed.push(hash);
    } catch (e) {
      failed.push({ hash: item.hash, error: e instanceof Error ? e.message : "commit failed" });
    }
  }
  return NextResponse.json({ ok: failed.length === 0, committed, failed });
}
```

- [ ] **Step 4: Run test to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/gallery/commit
git commit -m "feat(gallery): admin commit endpoint (re-derive + store + insert)"
```

---

## Task 7: Admin list + mutate endpoints

**Files:**
- Create: `src/app/api/admin/gallery/route.ts` (GET list-all)
- Create: `src/app/api/admin/gallery/[hash]/route.ts` (PATCH hidden, DELETE soft-delete)
- Test: `src/app/api/admin/gallery/route.test.ts`, `src/app/api/admin/gallery/[hash]/route.test.ts`

**Interfaces:**
- Consumes: `isAuthedGalleryAdmin`, `listAllForAdmin`, `setHidden`, `softDeleteUpload`.
- GET → `{ ok: true, presets: [...] }`. PATCH body `{ hidden: boolean }` → `{ ok: true }`. DELETE → `{ ok: boolean, reason? }` (409 when `builtin_not_deletable`, 404 when `not_found`).

- [ ] **Step 1: Write the failing tests**

`src/app/api/admin/gallery/[hash]/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
vi.mock("@/lib/cup-label/gallery-admin-auth", () => ({ isAuthedGalleryAdmin: () => ({ ok: true }) }));
const calls: any = {};
vi.mock("@/lib/cup-label/gallery-store", () => ({
  setHidden: async (h: string, v: boolean) => { calls.hidden = [h, v]; },
  softDeleteUpload: async (h: string) => (h === "builtinhash" ? { ok: false, reason: "builtin_not_deletable" } : { ok: true }),
}));
import { PATCH, DELETE } from "./route";

beforeEach(() => { process.env.GALLERY_ADMIN_TOKEN = "t"; });

describe("[hash] route", () => {
  it("PATCH sets hidden", async () => {
    const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ hidden: true }) }), { params: Promise.resolve({ hash: "h1" }) });
    expect((await res.json()).ok).toBe(true);
    expect(calls.hidden).toEqual(["h1", true]);
  });
  it("DELETE builtin → 409", async () => {
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), { params: Promise.resolve({ hash: "builtinhash" }) });
    expect(res.status).toBe(409);
  });
});
```

`src/app/api/admin/gallery/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
vi.mock("@/lib/cup-label/gallery-admin-auth", () => ({ isAuthedGalleryAdmin: () => ({ ok: true }) }));
vi.mock("@/lib/cup-label/gallery-store", () => ({ listAllForAdmin: async () => [{ hash: "h1", source: "builtin", thumbUrl: "/x", hidden: false, deletedAt: null }] }));
import { GET } from "./route";
beforeEach(() => { process.env.GALLERY_ADMIN_TOKEN = "t"; });
it("GET returns presets", async () => {
  const res = await GET(new Request("http://x"));
  expect((await res.json()).presets).toHaveLength(1);
});
```

- [ ] **Step 2: Run tests to verify they fail** — FAIL (no routes).

- [ ] **Step 3: Write the implementations**

`src/app/api/admin/gallery/route.ts`:

```ts
import { NextResponse } from "next/server";
import { isAuthedGalleryAdmin } from "@/lib/cup-label/gallery-admin-auth";
import { listAllForAdmin } from "@/lib/cup-label/gallery-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = isAuthedGalleryAdmin(request);
  if (!auth.ok) return NextResponse.json({ ok: false, reason: auth.reason }, { status: auth.reason === "unconfigured" ? 500 : 401 });
  const presets = await listAllForAdmin();
  return NextResponse.json({ ok: true, presets });
}
```

`src/app/api/admin/gallery/[hash]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { isAuthedGalleryAdmin } from "@/lib/cup-label/gallery-admin-auth";
import { setHidden, softDeleteUpload } from "@/lib/cup-label/gallery-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ hash: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  const auth = isAuthedGalleryAdmin(request);
  if (!auth.ok) return NextResponse.json({ ok: false, reason: auth.reason }, { status: auth.reason === "unconfigured" ? 500 : 401 });
  const { hash } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { hidden?: unknown } | null;
  if (typeof body?.hidden !== "boolean") return NextResponse.json({ ok: false, error: "hidden boolean required" }, { status: 400 });
  await setHidden(hash, body.hidden);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, ctx: Ctx) {
  const auth = isAuthedGalleryAdmin(request);
  if (!auth.ok) return NextResponse.json({ ok: false, reason: auth.reason }, { status: auth.reason === "unconfigured" ? 500 : 401 });
  const { hash } = await ctx.params;
  const r = await softDeleteUpload(hash);
  if (!r.ok) return NextResponse.json(r, { status: r.reason === "not_found" ? 404 : 409 });
  return NextResponse.json(r);
}
```

- [ ] **Step 4: Run tests to verify they pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/gallery/route.ts src/app/api/admin/gallery/route.test.ts src/app/api/admin/gallery/\[hash\]
git commit -m "feat(gallery): admin list + hide(PATCH) + soft-delete(DELETE)"
```

---

## Task 8: Public merged read endpoint (with static fallback)

**Files:**
- Create: `src/app/api/cup-label/gallery/route.ts`
- Test: `src/app/api/cup-label/gallery/route.test.ts`

**Interfaces:**
- Consumes: `listVisiblePresets`. On DB error, falls back to reading `public/cup-label/gallery/manifest.json` → builtin-only list.
- Produces `{ ok: true, presets: VisiblePreset[] }`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
let mode: "ok" | "throw" = "ok";
vi.mock("@/lib/cup-label/gallery-store", () => ({
  listVisiblePresets: async () => { if (mode === "throw") throw new Error("db down"); return [{ hash: "h1", source: "upload", thumbUrl: "https://cdn/h1/color.png" }]; },
}));
vi.mock("node:fs/promises", () => ({ readFile: async () => JSON.stringify({ hashes: ["b1", "b2"] }) }));
import { GET } from "./route";

describe("GET /api/cup-label/gallery", () => {
  it("returns merged visible presets", async () => {
    mode = "ok";
    const res = await GET();
    expect((await res.json()).presets[0].hash).toBe("h1");
  });
  it("falls back to static manifest on db error", async () => {
    mode = "throw";
    const res = await GET();
    const json = await res.json();
    expect(json.presets.map((p: any) => p.hash)).toEqual(["b1", "b2"]);
    expect(json.presets[0].thumbUrl).toBe("/cup-label/gallery/b1/binarized.png");
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL (no route).

- [ ] **Step 3: Write the implementation**

```ts
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
    console.error("[cup-label/gallery] db read failed, falling back to static manifest:", e instanceof Error ? e.message : e);
    try {
      const raw = await readFile(join(process.cwd(), "public", "cup-label", "gallery", "manifest.json"), "utf8");
      const { hashes } = JSON.parse(raw) as { hashes: string[] };
      const presets = hashes.map((hash) => ({ hash, source: "builtin" as const, thumbUrl: `/cup-label/gallery/${hash}/binarized.png` }));
      return NextResponse.json({ ok: true, presets, degraded: true });
    } catch {
      return NextResponse.json({ ok: true, presets: [] });
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cup-label/gallery
git commit -m "feat(gallery): public merged read endpoint + static fallback"
```

---

## Task 9: Web LabelPicker consumes merged endpoint

**Files:**
- Modify: `src/components/checkout/LabelPicker.tsx:25,59-67,203-237`
- Test: manual (chrome-devtools) — component fetch swap; covered by Task 8 unit + render check.

**Interfaces:**
- Consumes: `GET /api/cup-label/gallery` → `{ presets: Array<{ hash; thumbUrl; source }> }`.

- [ ] **Step 1: Replace the manifest type + loader**

In `LabelPicker.tsx`, change line 25 and 59-67:

```tsx
type GalleryItem = { hash: string; thumbUrl: string; source: "builtin" | "upload" };
type Gallery = { presets: GalleryItem[] };

let galleryCache: Gallery | null = null;
async function loadGallery(): Promise<Gallery> {
  if (galleryCache) return galleryCache;
  const res = await fetch("/api/cup-label/gallery");
  if (!res.ok) throw new Error(`gallery fetch failed: ${res.status}`);
  const data = (await res.json()) as Gallery;
  galleryCache = data;
  return data;
}
```

- [ ] **Step 2: Update the preset tab state + render (lines 203-237)**

```tsx
  const [gallery, setGallery] = useState<Gallery | null>(galleryCache);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (gallery) return;
    loadGallery().then(setGallery).catch((e) => setError(String(e)));
  }, [gallery]);

  if (error) return <p className="text-sm text-red-600">Failed to load gallery: {error}</p>;
  if (!gallery) return <p className="text-sm text-zinc-500">Loading…</p>;
  // ...grid...
      {gallery.presets.map(({ hash, thumbUrl }) => {
        const selected = hash === current;
        return (
          <button key={hash} type="button" onClick={() => onSelect(hash)} /* ...unchanged classes/aria... */>
            <Image src={thumbUrl} alt="" width={592} height={592} unoptimized className="h-full w-full object-contain p-1" />
            {/* selected check unchanged */}
          </button>
        );
      })}
```

(Keep all existing className/style/aria attributes from lines 218-244; only `key`/`onClick`/`src` derive from the new shape. `onSelect(hash)` and the emitted `{ kind: "preset", hash }` are unchanged.)

- [ ] **Step 3: Run web tests + typecheck**

Run: `npx vitest run src/components/checkout && npx tsc --noEmit`
Expected: PASS / 0 errors.

- [ ] **Step 4: Real render check**

Start dev server; open the checkout LabelPicker Gallery tab via chrome-devtools; confirm thumbnails load (built-ins from `/cup-label/...`, any uploads from the bucket URL), 0 console errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/checkout/LabelPicker.tsx
git commit -m "feat(gallery): LabelPicker reads merged /api/cup-label/gallery"
```

---

## Task 10: enqueue dual-source preset resolution

**Files:**
- Modify: `src/lib/cup-label/enqueue.ts:381-399`
- Test: `src/lib/cup-label/enqueue.gallery.test.ts`

**Interfaces:**
- Consumes: `getPresetSource`, `downloadBucketBinarized` from `./gallery-store`.
- Behavior: for a `presetStickerHash`, if `getPresetSource(hash) === "upload"` → `downloadBucketBinarized(hash)`; otherwise read `public/cup-label/gallery/{hash}/binarized.png` from disk (unchanged). Both set `source="preset_sticker"`, `poolKey=hash`, `keepsakeEligible=true`. On any failure → existing `useDefaultFallback()`.

- [ ] **Step 1: Write the failing test** (mock fs + gallery-store; assert upload hash routes to bucket download)

```ts
import { describe, it, expect, vi } from "vitest";
const fsRead = vi.fn(async () => Buffer.from("DISK"));
vi.mock("node:fs", () => ({ promises: { readFile: fsRead } }));
const sourceOf = vi.fn(async (h: string) => (h === "u".repeat(32) ? "upload" : "builtin"));
const bucketDl = vi.fn(async () => Buffer.from("BUCKET"));
vi.mock("./gallery-store", () => ({ getPresetSource: (h: string) => sourceOf(h), downloadBucketBinarized: () => bucketDl() }));
import { resolvePresetBuffer } from "./enqueue";

describe("resolvePresetBuffer", () => {
  it("upload hash → bucket download", async () => {
    expect((await resolvePresetBuffer("u".repeat(32))).toString()).toBe("BUCKET");
    expect(bucketDl).toHaveBeenCalled();
  });
  it("builtin hash → disk read", async () => {
    expect((await resolvePresetBuffer("b".repeat(32))).toString()).toBe("DISK");
    expect(fsRead).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL (`resolvePresetBuffer` not exported).

- [ ] **Step 3: Extract + implement `resolvePresetBuffer`, wire into the block at 381-399**

Add near the top imports of `enqueue.ts`:

```ts
import { getPresetSource, downloadBucketBinarized } from "./gallery-store";
```

Add the exported helper (above `enqueueCupLabelJobs`):

```ts
/** Resolve a preset sticker's 1-bit print buffer from the right source. */
export async function resolvePresetBuffer(hash: string): Promise<Buffer> {
  const source = await getPresetSource(hash);
  if (source === "upload") return downloadBucketBinarized(hash);
  return fs.readFile(path.join(GALLERY_DIR, hash, "binarized.png"));
}
```

Replace the body of the `else if (presetStickerHash)` branch (currently 385-392) so the disk `fs.readFile` is replaced by the helper:

```ts
        try {
          doodlePngBuffer = await resolvePresetBuffer(presetStickerHash);
          source = "preset_sticker";
          poolKey = presetStickerHash;
          originalImagePath = `cup-label/gallery/${presetStickerHash}/binarized.png`;
          doodleSvg = "";
          keepsakeEligible = true;
        } catch (e) {
          console.error("[cup-label] preset sticker load failed, falling back", { hash: presetStickerHash, error: e instanceof Error ? e.message : e });
          await useDefaultFallback();
        }
```

- [ ] **Step 4: Run test + full enqueue suite + typecheck**

Run: `npx vitest run src/lib/cup-label && npx tsc --noEmit`
Expected: PASS / 0 errors (existing preset tests still green — builtin path unchanged in behavior).

- [ ] **Step 5: Commit**

```bash
git add src/lib/cup-label/enqueue.ts src/lib/cup-label/enqueue.gallery.test.ts
git commit -m "feat(gallery): enqueue resolves uploads from bucket, builtins from disk"
```

---

## Task 11: Admin server-side web-API caller

**Files (admin repo `mandys_bubble_tea_admin`):**
- Create: `src/lib/gallery.ts`
- Test: `src/lib/gallery.test.ts`

**Interfaces:**
- Produces: `listGalleryForAdmin()`, `previewGalleryImages(images)`, `commitGalleryImages(items, createdBy)`, `setGalleryHidden(hash, hidden)`, `deleteGalleryUpload(hash)` — each `fetch`es `${WEB_ORIGIN}/api/admin/gallery/...` with `Authorization: Bearer ${GALLERY_ADMIN_TOKEN}`. `WEB_ORIGIN = process.env.NEXT_PUBLIC_WEB_ORIGIN ?? "https://mandybubbletea.com"`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { listGalleryForAdmin } from "./gallery";

beforeEach(() => { process.env.GALLERY_ADMIN_TOKEN = "t"; process.env.NEXT_PUBLIC_WEB_ORIGIN = "https://web"; });

it("listGalleryForAdmin calls web admin endpoint with bearer token", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, presets: [{ hash: "h1" }] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const presets = await listGalleryForAdmin();
  expect(presets).toHaveLength(1);
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("https://web/api/admin/gallery");
  expect((init as RequestInit).headers).toMatchObject({ authorization: "Bearer t" });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL (no module).

- [ ] **Step 3: Write the implementation**

```ts
import "server-only";

const WEB_ORIGIN = process.env.NEXT_PUBLIC_WEB_ORIGIN ?? "https://mandybubbletea.com";

function authHeaders(json = false): Record<string, string> {
  const h: Record<string, string> = { authorization: `Bearer ${process.env.GALLERY_ADMIN_TOKEN ?? ""}` };
  if (json) h["content-type"] = "application/json";
  return h;
}

export type AdminPreset = { hash: string; source: "builtin" | "upload"; thumbUrl: string; hidden: boolean; deletedAt: string | null };

export async function listGalleryForAdmin(): Promise<AdminPreset[]> {
  const res = await fetch(`${WEB_ORIGIN}/api/admin/gallery`, { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error(`gallery list failed: ${res.status}`);
  return (await res.json()).presets as AdminPreset[];
}

export async function previewGalleryImages(images: string[]) {
  const res = await fetch(`${WEB_ORIGIN}/api/admin/gallery/preview`, { method: "POST", headers: authHeaders(true), body: JSON.stringify({ images }) });
  if (!res.ok) throw new Error(`preview failed: ${res.status}`);
  return (await res.json()).results as Array<{ hash: string; colorDataUrl: string; binarizedDataUrl: string } | { error: string }>;
}

export async function commitGalleryImages(items: Array<{ image: string; hash: string }>, createdBy: string) {
  const res = await fetch(`${WEB_ORIGIN}/api/admin/gallery/commit`, { method: "POST", headers: authHeaders(true), body: JSON.stringify({ images: items, createdBy }) });
  if (!res.ok) throw new Error(`commit failed: ${res.status}`);
  return (await res.json()) as { ok: boolean; committed: string[]; failed: Array<{ hash: string; error: string }> };
}

export async function setGalleryHidden(hash: string, hidden: boolean) {
  const res = await fetch(`${WEB_ORIGIN}/api/admin/gallery/${hash}`, { method: "PATCH", headers: authHeaders(true), body: JSON.stringify({ hidden }) });
  if (!res.ok) throw new Error(`hide failed: ${res.status}`);
}

export async function deleteGalleryUpload(hash: string) {
  const res = await fetch(`${WEB_ORIGIN}/api/admin/gallery/${hash}`, { method: "DELETE", headers: authHeaders() });
  if (!res.ok && res.status !== 409 && res.status !== 404) throw new Error(`delete failed: ${res.status}`);
  return (await res.json()) as { ok: boolean; reason?: string };
}
```

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run src/lib/gallery.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gallery.ts src/lib/gallery.test.ts
git commit -m "feat(gallery): admin server caller for web gallery API"
```

---

## Task 12: Admin page + grid UI + nav

**Files (admin repo):**
- Create: `src/app/gallery/page.tsx`
- Create: `src/app/gallery/GalleryGrid.tsx`
- Modify: `src/components/shell/Sidebar.tsx`, `src/components/shell/BottomTabBar.tsx`

**Interfaces:**
- Consumes: `getAuthedAdmin` (auth), `listGalleryForAdmin` (initial data), client actions POST to local admin route handlers OR call the server actions. Use a thin admin API proxy: client calls `previewGalleryImages`/`commit`/`setHidden`/`delete` via Next server actions exported from a `"use server"` module, or via local route handlers. Simplest: server actions in `src/app/gallery/actions.ts`.

- [ ] **Step 1: Create server actions**

`src/app/gallery/actions.ts`:

```ts
"use server";
import { getAuthedAdmin } from "@/lib/auth";
import { previewGalleryImages, commitGalleryImages, setGalleryHidden, deleteGalleryUpload } from "@/lib/gallery";

async function assertAdmin() { if (!(await getAuthedAdmin())) throw new Error("unauthorized"); }

export async function previewAction(images: string[]) { await assertAdmin(); return previewGalleryImages(images); }
export async function commitAction(items: Array<{ image: string; hash: string }>) {
  const admin = await getAuthedAdmin(); if (!admin) throw new Error("unauthorized");
  return commitGalleryImages(items, admin.email);
}
export async function hideAction(hash: string, hidden: boolean) { await assertAdmin(); await setGalleryHidden(hash, hidden); }
export async function deleteAction(hash: string) { await assertAdmin(); return deleteGalleryUpload(hash); }
```

- [ ] **Step 2: Create the server page**

`src/app/gallery/page.tsx` (mirror `cup-doodles/page.tsx:1-43`):

```tsx
import { redirect } from "next/navigation";
import { getAuthedAdmin } from "@/lib/auth";
import { listGalleryForAdmin } from "@/lib/gallery";
import { PageHeader } from "@/components/shell/PageHeader";
import { GalleryGrid } from "./GalleryGrid";

export const dynamic = "force-dynamic";

export default async function GalleryPage() {
  const admin = await getAuthedAdmin();
  if (!admin) redirect("/sign-in?next=/gallery");
  const presets = await listGalleryForAdmin();
  return (
    <div className="space-y-4">
      <PageHeader title="杯标图库" subtitle="默认杯标 + 上传追加（隐藏对顾客即时生效）" />
      <GalleryGrid initial={presets} />
    </div>
  );
}
```

- [ ] **Step 3: Create the client grid**

`src/app/gallery/GalleryGrid.tsx` — grid of all presets (hidden greyed w/ "显示" toggle; uploads get "删除"); a file input (`multiple`) that reads each file to a data URL, calls `previewAction`, shows the B/W preview grid, then `commitAction` on "确认加入"; uses `useTransition` + `router.refresh()` after mutations. Include `AdminPreset` typing from `@/lib/gallery`. (Standard React; reuse Tailwind classes from `CupDoodlesGrid.tsx` for visual consistency.) Key behaviors:
  - read files: `const dataUrl = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(file); })`
  - preview → `const results = await previewAction(dataUrls)`; render each `binarizedDataUrl`, skip `{error}` entries with an inline message.
  - commit → `await commitAction(results.filter(ok).map(r => ({ image: r._dataUrl, hash: r.hash })))` — keep the original data URL alongside each preview result so commit re-sends raw. Then `router.refresh()`.
  - hide toggle → `await hideAction(hash, !hidden); router.refresh()`.
  - delete (upload only) → confirm dialog → `await deleteAction(hash); router.refresh()`.

- [ ] **Step 4: Add nav entries**

In `src/components/shell/Sidebar.tsx` add (after the cup-doodles item, ~line 30):

```ts
  { label: "图库", href: "/gallery", match: (p: string) => p.startsWith("/gallery") },
```

In `src/components/shell/BottomTabBar.tsx` add to the TABS array (note: bar is already 6 items; insert "图库" and verify it still fits — if crowded, fold under 杯标 group or drop the least-used tab per Stan):

```ts
  { key: "gallery", label: "图库", href: "/gallery", match: (p: string) => p.startsWith("/gallery") },
```

- [ ] **Step 5: Typecheck + build + real render**

Run: `npx tsc --noEmit && npm run build`
Then real render: sign in (admin session), open `/gallery` via chrome-devtools — confirm the 235 built-ins render, drag/drop a test PNG → B/W preview appears → 确认加入 → it shows in the grid; hide a built-in → greyed; delete the upload. 0 console errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/gallery src/components/shell/Sidebar.tsx src/components/shell/BottomTabBar.tsx
git commit -m "feat(gallery): admin gallery page (view/batch-upload/preview/hide/delete)"
```

---

## Task 13: RN app runtime-fetches the merged gallery

**Files (app repo `mandys_bubble_tea_app`):**
- Create: `lib/doodle/gallery-remote.ts`
- Modify: `components/doodle/DoodleModal.tsx:23,319`
- Test: `lib/doodle/gallery-remote.test.ts`

**Interfaces:**
- Produces: `fetchGallery(): Promise<Array<{ hash: string; thumbUrl: string; source: "builtin" | "upload" }>>` (GET `${API_BASE}/api/cup-label/gallery`); `presetImageSource(item)` → bundled `GALLERY_MANIFEST[hash]` when present, else `{ uri: absoluteUrl(thumbUrl) }`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { presetImageSource } from "./gallery-remote";
vi.mock("./gallery-manifest.generated", () => ({ GALLERY_MANIFEST: { b1: 42 }, GALLERY_HASHES: ["b1"] }));

describe("presetImageSource", () => {
  it("uses bundled require when hash is bundled", () => {
    expect(presetImageSource({ hash: "b1", thumbUrl: "/x", source: "builtin" })).toBe(42);
  });
  it("uses remote uri for uploads", () => {
    const src = presetImageSource({ hash: "u1", thumbUrl: "https://web/u1/color.png", source: "upload" });
    expect(src).toEqual({ uri: "https://web/u1/color.png" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL (no module). (Use the app's jest runner: `pnpm jest lib/doodle/gallery-remote`.)

- [ ] **Step 3: Write the implementation**

```ts
import { GALLERY_MANIFEST } from "./gallery-manifest.generated";
import type { ImageSourcePropType } from "react-native";
import { API_BASE_URL } from "@/lib/config"; // existing app config that yields the web origin

export type RemotePreset = { hash: string; thumbUrl: string; source: "builtin" | "upload" };

export async function fetchGallery(): Promise<RemotePreset[]> {
  const res = await fetch(`${API_BASE_URL}/api/cup-label/gallery`);
  if (!res.ok) throw new Error(`gallery fetch failed: ${res.status}`);
  return ((await res.json()).presets ?? []) as RemotePreset[];
}

export function presetImageSource(item: RemotePreset): ImageSourcePropType {
  const bundled = GALLERY_MANIFEST[item.hash];
  if (bundled) return bundled;
  const uri = item.thumbUrl.startsWith("http") ? item.thumbUrl : `${API_BASE_URL}${item.thumbUrl}`;
  return { uri };
}
```

(If the app has no `@/lib/config` export for the web origin, reuse whatever base the existing `lib/cup-label/client` upload calls use — find it and import that constant instead.)

- [ ] **Step 4: Wire into `DoodleModal.tsx`**

Replace the bundled-only render (`GALLERY_HASHES.map`, line 319) with a state-backed remote list: on modal open, `fetchGallery().then(setPresets)`; render `presets.map((item) => <Image source={presetImageSource(item)} ... />)`; on pick still emit the chosen `hash`. Keep a fallback to `GALLERY_HASHES` (bundled) if the fetch fails so the picker still works offline.

- [ ] **Step 5: Run test + typecheck**

Run: `pnpm jest lib/doodle/gallery-remote && npx tsc --noEmit`
Expected: PASS / 0 errors.

- [ ] **Step 6: Commit**

```bash
git add lib/doodle/gallery-remote.ts lib/doodle/gallery-remote.test.ts components/doodle/DoodleModal.tsx
git commit -m "feat(gallery): app runtime-fetches merged gallery (builtin bundle + remote uploads)"
```

---

## Self-Review

**Spec coverage:**
- Supabase table + bucket + seed 235 → Task 1 ✓
- Raw→binarized processing reusing `binarizeForThermal` → Task 2 ✓
- Store CRUD + merge/list/download → Task 3 ✓
- Staff-token guard → Task 4 ✓
- preview / commit (re-derive, hash-match) / list / hide(both) / soft-delete(upload, refuse builtin) → Tasks 5,6,7 ✓
- Public merged read + DB-error static fallback → Task 8 ✓
- Web LabelPicker consumes merged endpoint → Task 9 ✓
- enqueue dual-source (builtin disk / upload bucket) → Task 10 ✓
- Admin thin UI (view/batch-upload/preview/hide/delete) + nav → Tasks 11,12 ✓
- App runtime fetch + builtin-bundle/upload-remote render → Task 13 ✓
- Migration-before-deploy, no-drift dither (same `binarizeForThermal`), soft-delete keeps files, builtins hide-not-delete → encoded in Tasks 1/2/3/7 ✓

**Placeholder scan:** No "TBD/TODO". Task 12 step 3 and Task 13 step 4 describe UI wiring prose with the concrete mechanism (file-read snippet, action names, image-source resolver) rather than full JSX — acceptable because every external interface they call is fully specified in earlier tasks; the JSX is mechanical and reuses `CupDoodlesGrid.tsx`/`DoodleModal.tsx` patterns.

**Type consistency:** `VisiblePreset`/`AdminPreset` shapes line up across store (Task 3) → read API (Task 8) → admin caller (Task 11) → app (Task 13). `processGalleryImage` return `{ hash, colorPng, binarizedPng }` used identically in Tasks 5,6. `isAuthedGalleryAdmin` reason union (`unauthorized`/`unconfigured`) consistent across Tasks 4–8. `resolvePresetBuffer` name consistent in Task 10.

**Risks flagged for execution:**
- Task 3's network helpers (`listVisiblePresets` etc.) are unit-tested only at the pure boundary (`thumbUrlFor`); verify the live query behavior in Task 8 smoke + Task 12 real render against prod Supabase.
- Task 12 BottomTabBar is already 6 items — confirm spacing with Stan or fold into 杯标; don't silently overflow.
- Task 13 `API_BASE_URL` import path must be confirmed against the app's actual config module before coding.
