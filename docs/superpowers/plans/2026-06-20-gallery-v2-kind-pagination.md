# Cup-Label Gallery Admin v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the lucky-cat default deck from the selectable gallery (manageable, with real effect on the live random draw), add 碑帖-style framed cards + pagination + tabs, and allow soft-delete on every preset.

**Architecture:** Extend the v1 `gallery_presets` table with a `kind` column (`gallery`|`lucky_cat`), seed the 38 lucky-cats. Web filters the customer picker to `kind='gallery'`; enqueue's lucky-cat auto-fill reads the DB pool (disk-first/bucket, disk fallback on DB error). Admin UI gains tabs + client-side pagination + framed cards + delete-on-all + per-section upload.

**Tech Stack:** Next.js (web + admin, App Router, `runtime="nodejs"`), Supabase JS (service-role), sharp + `binarizeForThermal`, Vitest. App (React Native) untouched.

## Global Constraints

- Web worktree: `.claude/worktrees/gallery-v2/` on branch `feat/gallery-v2-kind-pagination` off `origin/main` (`0fe2bf5f`, which already contains gallery v1). **Do NOT touch `re-design`.**
- `kind` column: `text not null default 'gallery' check (kind in ('gallery','lucky_cat'))`. The 235 existing rows are `gallery` by default (no backfill). Seed 38 lucky-cats as `kind='lucky_cat', source='builtin', storage='static'`.
- Lucky-cats must **never** appear in the customer picker: `listVisiblePresets` filters `kind='gallery'`.
- Rare jackpot cat identity = code constant `RARE_LUCKY_CAT_HASH` from `@/lib/cup-label/lucky-cat` (`= "1357797c6c11d3bf7faf0a27efe630b5"`). No schema for it.
- Lucky-cat dir: `public/cup-label/lucky-cat/{hash}/binarized.png`; hash = lowercase MD5 hex (32 chars), dir names are the hashes.
- Bucket = `cup-label-gallery`; lucky-cat uploads reuse it at `{hash}/{color,binarized}.png`.
- Print path must never block an order: every preset/lucky-cat resolution falls through to existing fallbacks on failure.
- Soft-delete = `hidden=true` + `deleted_at=now()`; files (static + bucket) are retained.
- Admin pagination is client-side, 24 per page, per tab.
- Supabase admin client `getSupabaseAdmin()` from `@/lib/supabase-server`; server modules carry `import "server-only"`.
- Migration applies to prod **before** code deploy (additive). Commit after every task; run the focused test during steps, full touched-suite before the task's commit.

---

## File Structure

**Supabase**
- Create: `supabase/migrations/2026-06-20-gallery-presets-kind.sql`
- Create: `scripts/seed-lucky-cat-presets.ts` (+ test)

**Web (`mandys_bubble_tea`)**
- Modify: `src/lib/cup-label/gallery-store.ts` (kind filter, listAllForAdmin kind+deleted filter, insert kind, softDeletePreset, lucky-cat pool + resolver)
- Test: `src/lib/cup-label/gallery-store.v2.test.ts` (new)
- Modify: `src/app/api/admin/gallery/commit/route.ts` (kind param)
- Modify: `src/app/api/admin/gallery/[hash]/route.ts` (DELETE built-in allowed)
- Modify: `src/app/api/admin/gallery/[hash]/route.test.ts` (DELETE expectation)
- Modify: `src/lib/cup-label/enqueue.ts` (lucky-cat pool from DB + bucket resolver + disk fallback)
- Test: `src/lib/cup-label/enqueue.luckycat.test.ts` (new)

**Admin (`mandys_bubble_tea_admin`)**
- Modify: `src/lib/gallery.ts` (`AdminPreset.kind`, `commitGalleryImages(kind)`)
- Modify: `src/lib/gallery.test.ts` (kind in mock)
- Modify: `src/app/gallery/actions.ts` (`commitAction(kind)`)
- Modify: `src/app/gallery/GalleryGrid.tsx` (tabs, pagination, 碑帖 card, delete-all, per-section upload, rare badge)
- Modify: `src/app/gallery/page.tsx` (no change expected; verify it just passes the list)

---

## Task 1: Migration + lucky-cat seed

**Files:**
- Create: `supabase/migrations/2026-06-20-gallery-presets-kind.sql`
- Create: `scripts/seed-lucky-cat-presets.ts`
- Test: `src/seed-lucky-cat-presets.test.ts` (under src/ for vitest discovery; imports from `../scripts/...`)

**Interfaces:**
- Produces: `buildLuckyCatSeedRows(hashes: string[]): Array<{hash, source:'builtin', storage:'static', kind:'lucky_cat', hidden:false, sort_order:number}>`.

> NOTE: vitest `include` is `src/**/*.test.ts` only — the seed SCRIPT goes in `scripts/`, its TEST under `src/` (this is exactly how v1's `scripts/seed-gallery-presets.ts` + `src/seed-gallery-presets.test.ts` are arranged). Do NOT apply to prod — controller handles the prod apply at deploy.

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/2026-06-20-gallery-presets-kind.sql`:

```sql
-- v2: separate the lucky-cat default deck from the selectable gallery.
alter table public.gallery_presets
  add column if not exists kind text not null default 'gallery'
  check (kind in ('gallery','lucky_cat'));

create index if not exists gallery_presets_kind_visible_idx
  on public.gallery_presets (kind, sort_order)
  where hidden = false and deleted_at is null;
```

- [ ] **Step 2: Write the seed helper test**

Create `src/seed-lucky-cat-presets.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildLuckyCatSeedRows } from "../scripts/seed-lucky-cat-presets";

describe("buildLuckyCatSeedRows", () => {
  it("maps hashes to lucky_cat/builtin/static rows with ascending sort_order", () => {
    expect(buildLuckyCatSeedRows(["aaa", "bbb"])).toEqual([
      { hash: "aaa", source: "builtin", storage: "static", kind: "lucky_cat", hidden: false, sort_order: 0 },
      { hash: "bbb", source: "builtin", storage: "static", kind: "lucky_cat", hidden: false, sort_order: 1 },
    ]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/seed-lucky-cat-presets.test.ts`
Expected: FAIL — cannot find module `../scripts/seed-lucky-cat-presets`.

- [ ] **Step 4: Write the seed script**

Create `scripts/seed-lucky-cat-presets.ts`:

```ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/seed-lucky-cat-presets.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit (do NOT apply to prod)**

```bash
git add supabase/migrations/2026-06-20-gallery-presets-kind.sql scripts/seed-lucky-cat-presets.ts src/seed-lucky-cat-presets.test.ts
git commit -m "feat(gallery): kind column migration + lucky-cat seed script"
```

---

## Task 2: Store — kind filter, admin list, soft-delete-all, commit kind

**Files:**
- Modify: `src/lib/cup-label/gallery-store.ts`
- Test: `src/lib/cup-label/gallery-store.v2.test.ts`

**Interfaces:**
- Consumes: existing `getSupabaseAdmin`, `thumbUrlFor`.
- Produces:
  - `listVisiblePresets()` — now `.eq("kind","gallery")`.
  - `listAllForAdmin()` — returns rows with `kind` added; excludes soft-deleted (`deleted_at IS NULL`), includes hidden.
  - `insertUploadPreset(hash: string, createdBy: string, kind?: "gallery" | "lucky_cat")` — default `"gallery"`.
  - `softDeletePreset(hash: string): Promise<{ ok: boolean; reason?: "not_found" }>` — renamed from `softDeleteUpload`; no builtin refusal.

- [ ] **Step 1: Write the failing test**

Create `src/lib/cup-label/gallery-store.v2.test.ts` (mock supabase with a recording chain):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: any = {};
function makeSb() {
  return {
    from: () => ({
      select: (cols: string) => {
        calls.select = cols;
        const chain: any = {
          eq: (k: string, v: any) => { (calls.eq ||= []).push([k, v]); return chain; },
          is: (k: string, v: any) => { (calls.is ||= []).push([k, v]); return chain; },
          order: () => Promise.resolve({ data: calls._rows ?? [], error: null }),
          maybeSingle: () => Promise.resolve({ data: calls._single ?? null, error: null }),
        };
        return chain;
      },
      update: (patch: any) => { calls.update = patch; return { eq: () => Promise.resolve({ error: null }) }; },
      upsert: (row: any) => { calls.upsert = row; return Promise.resolve({ error: null }); },
    }),
    storage: { from: () => ({ getPublicUrl: (p: string) => ({ data: { publicUrl: `https://cdn/${p}` } }) }) },
  };
}
let sb: any;
vi.mock("@/lib/supabase-server", () => ({ getSupabaseAdmin: () => sb }));

import { listVisiblePresets, insertUploadPreset, softDeletePreset } from "./gallery-store";

beforeEach(() => { for (const k in calls) delete calls[k]; sb = makeSb(); });

describe("gallery-store v2", () => {
  it("listVisiblePresets filters kind=gallery", async () => {
    calls._rows = [];
    await listVisiblePresets();
    expect(calls.eq).toContainEqual(["kind", "gallery"]);
    expect(calls.eq).toContainEqual(["hidden", false]);
  });

  it("insertUploadPreset defaults kind=gallery and accepts lucky_cat", async () => {
    await insertUploadPreset("h", "admin");
    expect(calls.upsert.kind).toBe("gallery");
    await insertUploadPreset("h2", "admin", "lucky_cat");
    expect(calls.upsert.kind).toBe("lucky_cat");
  });

  it("softDeletePreset soft-deletes a builtin (no refusal)", async () => {
    calls._single = { source: "builtin" };
    const r = await softDeletePreset("h");
    expect(r).toEqual({ ok: true });
    expect(calls.update.deleted_at).toBeTypeOf("string");
    expect(calls.update.hidden).toBe(true);
  });

  it("softDeletePreset returns not_found when missing", async () => {
    calls._single = null;
    expect(await softDeletePreset("h")).toEqual({ ok: false, reason: "not_found" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/cup-label/gallery-store.v2.test.ts`
Expected: FAIL — `softDeletePreset` is not exported (still `softDeleteUpload`); kind filter / param absent.

- [ ] **Step 3: Edit the store**

In `src/lib/cup-label/gallery-store.ts`:

(a) `listVisiblePresets` — add the kind filter (the chain currently does `.eq("hidden", false).is("deleted_at", null).order(...)`); insert `.eq("kind", "gallery")`:
```ts
    .from("gallery_presets")
    .select("hash,source,storage,hidden,sort_order,deleted_at")
    .eq("kind", "gallery")
    .eq("hidden", false)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true });
```

(b) `listAllForAdmin` — select `kind`, exclude soft-deleted, map `kind` through:
```ts
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
```

(c) `insertUploadPreset` — add `kind` param:
```ts
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
```

(d) Rename `softDeleteUpload` → `softDeletePreset` and drop the builtin refusal:
```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/cup-label/gallery-store.v2.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the existing store test (no regression) + commit**

Run: `npx vitest run src/lib/cup-label/gallery-store.test.ts`
Expected: PASS (the v1 `thumbUrlFor` test still green).

```bash
git add src/lib/cup-label/gallery-store.ts src/lib/cup-label/gallery-store.v2.test.ts
git commit -m "feat(gallery): store kind filter, admin list kind, soft-delete-all, commit kind"
```

---

## Task 3: Store — lucky-cat pool + binarized resolver

**Files:**
- Modify: `src/lib/cup-label/gallery-store.ts`
- Test: `src/lib/cup-label/gallery-store.luckycat.test.ts`

**Interfaces:**
- Consumes: `getSupabaseAdmin`, `downloadBucketBinarized` (existing), `RARE_LUCKY_CAT_HASH` from `@/lib/cup-label/lucky-cat`, `node:fs/promises`, `node:path`.
- Produces:
  - `splitLuckyCatPool(hashes: string[]): { commons: string[]; hasRare: boolean }` — pure.
  - `listLuckyCatPoolHashes(): Promise<{ commons: string[]; hasRare: boolean }>` — DB query `kind='lucky_cat' AND hidden=false AND deleted_at IS NULL` → `splitLuckyCatPool`.
  - `getLuckyCatBinarized(hash: string): Promise<Buffer>` — disk-first (`public/cup-label/lucky-cat/{hash}/binarized.png`) then bucket (`downloadBucketBinarized`).

- [ ] **Step 1: Write the failing test**

Create `src/lib/cup-label/gallery-store.luckycat.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/cup-label/lucky-cat", () => ({ RARE_LUCKY_CAT_HASH: "RARE" }));
const fsRead = vi.fn(async () => Buffer.from("DISK"));
vi.mock("node:fs", () => ({ promises: { readFile: fsRead } }));
const bucketDl = vi.fn(async () => Buffer.from("BUCKET"));
vi.mock("@/lib/supabase-server", () => ({ getSupabaseAdmin: () => ({}) }));
// downloadBucketBinarized is in the same module under test; we drive it via the disk-miss path.

import { splitLuckyCatPool, getLuckyCatBinarized } from "./gallery-store";

describe("lucky-cat pool", () => {
  it("splitLuckyCatPool separates rare from commons", () => {
    expect(splitLuckyCatPool(["a", "RARE", "b"])).toEqual({ commons: ["a", "b"], hasRare: true });
    expect(splitLuckyCatPool(["a", "b"])).toEqual({ commons: ["a", "b"], hasRare: false });
  });

  it("getLuckyCatBinarized reads disk first", async () => {
    fsRead.mockResolvedValueOnce(Buffer.from("DISK"));
    expect((await getLuckyCatBinarized("h")).toString()).toBe("DISK");
  });
});
```

> The disk-miss→bucket path is covered indirectly by enqueue's Task 5 test (which mocks both). Keep this test to the pure split + the disk-hit path.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/cup-label/gallery-store.luckycat.test.ts`
Expected: FAIL — `splitLuckyCatPool` / `getLuckyCatBinarized` not exported.

- [ ] **Step 3: Add the functions to the store**

Add imports at top of `gallery-store.ts`:
```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { RARE_LUCKY_CAT_HASH } from "@/lib/cup-label/lucky-cat";
```
Add:
```ts
const LUCKY_CAT_DIR = path.join(process.cwd(), "public", "cup-label", "lucky-cat");

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/cup-label/gallery-store.luckycat.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cup-label/gallery-store.ts src/lib/cup-label/gallery-store.luckycat.test.ts
git commit -m "feat(gallery): lucky-cat DB pool + disk-first/bucket binarized resolver"
```

---

## Task 4: Admin API — commit kind + delete built-ins

**Files:**
- Modify: `src/app/api/admin/gallery/commit/route.ts`
- Modify: `src/app/api/admin/gallery/[hash]/route.ts`
- Modify: `src/app/api/admin/gallery/[hash]/route.test.ts`
- Modify: `src/app/api/admin/gallery/commit/route.test.ts`

**Interfaces:**
- Consumes: `insertUploadPreset(hash, createdBy, kind)`, `softDeletePreset(hash)` (Task 2).
- commit body now `{ images: Array<{image,hash}>, createdBy?, kind?: "gallery"|"lucky_cat" }`.

- [ ] **Step 1: Update the DELETE test to expect built-in success**

In `src/app/api/admin/gallery/[hash]/route.test.ts`, the v1 test mocks `softDeleteUpload` and asserts a builtin → 409. Replace the mock + assertion:
```ts
vi.mock("@/lib/cup-label/gallery-store", () => ({
  setHidden: async (h: string, v: boolean) => { calls.hidden = [h, v]; },
  softDeletePreset: async (h: string) => (h === "missing" ? { ok: false, reason: "not_found" } : { ok: true }),
}));
```
And change the builtin case to assert success, plus a not-found case:
```ts
  it("DELETE soft-deletes any preset (incl. builtin) → 200", async () => {
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), { params: Promise.resolve({ hash: "anyhash" }) });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
  it("DELETE missing → 404", async () => {
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), { params: Promise.resolve({ hash: "missing" }) });
    expect(res.status).toBe(404);
  });
```

- [ ] **Step 2: Add a commit-kind test**

In `src/app/api/admin/gallery/commit/route.test.ts`, extend the gallery-store mock to record `insertUploadPreset`'s kind arg, and add:
```ts
  it("passes kind=lucky_cat through to insertUploadPreset", async () => {
    const one = await img();
    const body = JSON.stringify({ images: [one], kind: "lucky_cat" });
    await POST(new Request("http://x", { method: "POST", body }));
    expect(insertKinds).toContain("lucky_cat");  // insertKinds pushed by the mock
  });
```
(Adjust the existing `vi.mock("@/lib/cup-label/gallery-store", ...)` so `insertUploadPreset: async (_h, _c, kind) => { insertKinds.push(kind); }` records the third arg; declare `const insertKinds: string[] = []` and reset in `beforeEach`.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run "src/app/api/admin/gallery/[hash]/route.test.ts" src/app/api/admin/gallery/commit/route.test.ts`
Expected: FAIL — route still imports `softDeleteUpload`; commit ignores `kind`.

- [ ] **Step 4: Update the routes**

`src/app/api/admin/gallery/[hash]/route.ts` — swap the import and the DELETE call:
```ts
import { setHidden, softDeletePreset } from "@/lib/cup-label/gallery-store";
// ...in DELETE:
  const r = await softDeletePreset(hash);
  if (!r.ok) return NextResponse.json(r, { status: r.reason === "not_found" ? 404 : 409 });
  return NextResponse.json(r);
```

`src/app/api/admin/gallery/commit/route.ts` — read `kind` from the body and pass it:
```ts
  const body = (await request.json().catch(() => null)) as
    { images?: Array<{ image: string; hash: string }>; createdBy?: string; kind?: "gallery" | "lucky_cat" } | null;
  // ...
  const kind = body?.kind === "lucky_cat" ? "lucky_cat" : "gallery";
  // ...inside the per-image success branch:
      await uploadBucketArtifacts(hash, colorPng, binarizedPng);
      await insertUploadPreset(hash, createdBy, kind);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/app/api/admin/gallery`
Expected: PASS (commit + [hash] + list suites green).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/admin/gallery
git commit -m "feat(gallery): admin commit kind + delete built-ins (soft-delete-all)"
```

---

## Task 5: enqueue — lucky-cat pool from DB + bucket + disk fallback

**Files:**
- Modify: `src/lib/cup-label/enqueue.ts`
- Test: `src/lib/cup-label/enqueue.luckycat.test.ts`

**Interfaces:**
- Consumes: `listLuckyCatPoolHashes`, `getLuckyCatBinarized` from `./gallery-store` (Task 3).
- Replaces the disk-scan `listLuckyCatHashes()` (currently reads `LUCKY_CAT_DIR`) with a DB-backed `luckyCatPool()` that falls back to the existing disk scan on DB error. The drawn-cat binarized read switches from `fs.readFile(LUCKY_CAT_DIR/...)` to `getLuckyCatBinarized(hash)`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/cup-label/enqueue.luckycat.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
const pool = vi.fn(async () => ({ commons: ["c1", "c2"], hasRare: false }));
const diskScan = vi.fn(async () => ({ commons: ["disk1"], hasRare: false }));
vi.mock("./gallery-store", () => ({
  listLuckyCatPoolHashes: () => pool(),
  getLuckyCatBinarized: async () => Buffer.from("CAT"),
}));
import { luckyCatPool } from "./enqueue";

describe("luckyCatPool", () => {
  it("returns the DB pool when DB is healthy", async () => {
    pool.mockResolvedValueOnce({ commons: ["c1"], hasRare: true });
    expect(await luckyCatPool(diskScan)).toEqual({ commons: ["c1"], hasRare: true });
    expect(diskScan).not.toHaveBeenCalled();
  });
  it("falls back to the disk scan when the DB throws", async () => {
    pool.mockRejectedValueOnce(new Error("db down"));
    expect(await luckyCatPool(diskScan)).toEqual({ commons: ["disk1"], hasRare: false });
    expect(diskScan).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/cup-label/enqueue.luckycat.test.ts`
Expected: FAIL — `luckyCatPool` not exported.

- [ ] **Step 3: Edit enqueue.ts**

Add import near the existing gallery-store import:
```ts
import { listLuckyCatPoolHashes, getLuckyCatBinarized } from "./gallery-store";
```
Keep the existing private `listLuckyCatHashes()` (the disk scan) and add an exported wrapper that prefers the DB pool and falls back to it:
```ts
/** Lucky-cat pool for the auto-fill draw. DB-driven (honors admin hide/upload);
 *  falls back to the on-disk deck scan if Supabase is unreachable so the
 *  fallback never breaks. `diskScan` is injected for testability. */
export async function luckyCatPool(
  diskScan: () => Promise<{ commons: string[]; hasRare: boolean }> = listLuckyCatHashes,
): Promise<{ commons: string[]; hasRare: boolean }> {
  try {
    return await listLuckyCatPoolHashes();
  } catch (e) {
    console.error("[cup-label] lucky-cat DB pool failed, falling back to disk scan:", e instanceof Error ? e.message : e);
    return diskScan();
  }
}
```
Replace the call site (currently `const { commons: luckyCatCommons, hasRare: luckyCatHasRare } = await listLuckyCatHashes();`):
```ts
  const { commons: luckyCatCommons, hasRare: luckyCatHasRare } = await luckyCatPool();
```
Replace the drawn-cat disk read inside `drawLuckyCat` (currently `doodlePngBuffer = await fs.readFile(path.join(LUCKY_CAT_DIR, hash, "binarized.png"));`):
```ts
          doodlePngBuffer = await getLuckyCatBinarized(hash);
```
(`originalImagePath` and the rest of the `drawLuckyCat` body stay; the `try/catch` that returns false on load failure stays, so the logo/POOL safety net is preserved.)

- [ ] **Step 4: Run test + full cup-label suite + tsc**

Run: `npx vitest run src/lib/cup-label && npx tsc --noEmit`
Expected: new test PASS; full cup-label suite green (existing enqueue/lucky-cat tests unaffected — the disk scan helper is retained); tsc 0 new errors (printer-client usb/express errors pre-existing).

- [ ] **Step 5: Commit**

```bash
git add src/lib/cup-label/enqueue.ts src/lib/cup-label/enqueue.luckycat.test.ts
git commit -m "feat(gallery): enqueue draws lucky-cats from DB pool (bucket + disk fallback)"
```

---

## Task 6: Admin caller — kind on type + commit

**Files (admin repo `mandys_bubble_tea_admin`):**
- Modify: `src/lib/gallery.ts`
- Modify: `src/lib/gallery.test.ts`
- Modify: `src/app/gallery/actions.ts`

**Interfaces:**
- Produces: `AdminPreset` gains `kind: "gallery" | "lucky_cat"`; `commitGalleryImages(items, createdBy, kind)`; `commitAction(items, kind)` server action.

- [ ] **Step 1: Update the test mock to include kind + assert commit forwards kind**

In `src/lib/gallery.test.ts`, the existing list mock presets should include `kind`. Add a focused test:
```ts
it("commitGalleryImages forwards kind in the POST body", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, committed: [], failed: [] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await commitGalleryImages([{ image: "data:...", hash: "h" }], "admin@x", "lucky_cat");
  const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
  expect(body.kind).toBe("lucky_cat");
});
```
(Import `commitGalleryImages` at top.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/gallery.test.ts`
Expected: FAIL — `commitGalleryImages` has no `kind` param / doesn't send it.

- [ ] **Step 3: Edit `src/lib/gallery.ts`**

Add `kind` to the type:
```ts
export type AdminPreset = {
  hash: string;
  source: "builtin" | "upload";
  thumbUrl: string;
  hidden: boolean;
  deletedAt: string | null;
  kind: "gallery" | "lucky_cat";
};
```
Add the `kind` arg to commit (default gallery), forward it:
```ts
export async function commitGalleryImages(
  items: Array<{ image: string; hash: string }>, createdBy: string, kind: "gallery" | "lucky_cat" = "gallery",
) {
  const res = await fetch(`${getWebOrigin()}/api/admin/gallery/commit`, {
    method: "POST", headers: authHeaders(true), body: JSON.stringify({ images: items, createdBy, kind }),
  });
  if (!res.ok) throw new Error(`commit failed: ${res.status}`);
  return (await res.json()) as { ok: boolean; committed: string[]; failed: Array<{ hash: string; error: string }> };
}
```

- [ ] **Step 4: Update the server action**

In `src/app/gallery/actions.ts`, thread `kind` through `commitAction`:
```ts
export async function commitAction(items: Array<{ image: string; hash: string }>, kind: "gallery" | "lucky_cat") {
  const admin = await getAuthedAdmin(); if (!admin) throw new Error("unauthorized");
  return commitGalleryImages(items, admin.email, kind);
}
```

- [ ] **Step 5: Run test + tsc**

Run: `npx vitest run src/lib/gallery.test.ts && npx tsc --noEmit`
Expected: PASS; tsc reports only pre-existing errors (none in gallery.ts/actions.ts).

- [ ] **Step 6: Commit**

```bash
git add src/lib/gallery.ts src/lib/gallery.test.ts src/app/gallery/actions.ts
git commit -m "feat(gallery): admin caller carries kind through commit"
```

---

## Task 7: Admin UI — tabs, pagination, 碑帖 cards, delete-all, per-section upload, rare badge

**Files (admin repo):**
- Modify: `src/app/gallery/GalleryGrid.tsx`
- Verify (likely no change): `src/app/gallery/page.tsx`

**Interfaces:**
- Consumes: `AdminPreset` (with `kind`), `previewAction`, `commitAction(items, kind)`, `hideAction(hash, hidden)`, `deleteAction(hash)` from `./actions`.

This task rewrites the single-grid `GalleryGrid` into a tabbed, paginated, 碑帖-styled view. The data flow (file→dataURL→previewAction→preview grid→commitAction→router.refresh) is preserved from v1; what changes is layout + per-tab state + delete-on-all + the commit `kind`.

- [ ] **Step 1: Implement the new GalleryGrid**

Rewrite `src/app/gallery/GalleryGrid.tsx` with:
- A `RARE_HASH = "1357797c6c11d3bf7faf0a27efe630b5"` const (mirror of `RARE_LUCKY_CAT_HASH`; comment that it mirrors `@/lib/cup-label/lucky-cat`).
- `const [tab, setTab] = useState<"gallery" | "lucky_cat">("gallery")` and `const [page, setPage] = useState(0)` (reset page to 0 on tab change).
- `const items = initial.filter((p) => p.kind === tab)`; `const PAGE = 24`; `const pageItems = items.slice(page*PAGE, page*PAGE+PAGE)`; page count `Math.ceil(items.length/PAGE)`.
- Tab bar: two buttons `图库 (gallery count)` / `招财猫 (lucky_cat count)`.
- Upload control bound to the active tab; on commit call `commitAction(committedItems, tab)`.
- Grid of `pageItems.map(PresetCard)`.
- Prev/next pagination control showing `page+1 / pageCount`.
- `PresetCard` (碑帖-light): a framed card — cream/rice background (`bg-[#f3ecdc]` or the repo's existing cream token), `border` + an inner `ring`/double-line frame, the sticker `<img src={thumbUrl}>` centered, the hash truncated as a caption, a "头奖" badge when `hash === RARE_HASH && tab === "lucky_cat"`, greyed when `hidden`. **Both** a hide/unhide toggle **and** a delete button (with `window.confirm`) on **every** card. After hide/delete, call `router.refresh()`.

Concrete card skeleton:
```tsx
function PresetCard({ preset, isRare }: { preset: AdminPreset; isRare: boolean }) {
  const router = useRouter();
  const [busy, startBusy] = useTransition();
  return (
    <div className={`relative rounded-sm border border-[#cbb98f] bg-[#f3ecdc] p-2 shadow-sm ${preset.hidden ? "opacity-40" : ""}`}>
      <div className="ring-1 ring-inset ring-[#cbb98f]/60 rounded-sm bg-[#fbf7ec] p-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={preset.thumbUrl} alt={preset.hash} className="aspect-square w-full object-contain" />
      </div>
      {isRare && <span className="absolute right-2 top-2 rounded bg-amber-700 px-1.5 py-0.5 text-xs text-white">头奖</span>}
      <div className="mt-1 truncate text-center text-[11px] tracking-wide text-[#7a6a44]">{preset.hash.slice(0, 12)}</div>
      <div className="mt-1 flex justify-center gap-2 text-xs">
        <button disabled={busy} onClick={() => startBusy(async () => { await hideAction(preset.hash, !preset.hidden); router.refresh(); })}>
          {preset.hidden ? "取消隐藏" : "隐藏"}
        </button>
        <button disabled={busy} className="text-red-700" onClick={() => { if (confirm("删除这张？(可恢复)")) startBusy(async () => { await deleteAction(preset.hash); router.refresh(); }); }}>
          删除
        </button>
      </div>
    </div>
  );
}
```
(Use `useRouter` from `next/navigation`; keep the existing preview/commit UI but move it under the active tab and pass `tab` to `commitAction`.)

- [ ] **Step 2: Typecheck + build**

Run (admin repo): `npx tsc --noEmit && npm run build`
Expected: 0 new tsc errors; `next build` succeeds, `/gallery` route emitted. (Confirm `GalleryGrid` imports only `./actions`, not `@/lib/gallery` runtime — type-only import of `AdminPreset` is fine.)

- [ ] **Step 3: Real render (chrome-devtools — controller does this at verification, OR /tester)**

The implementer SKIPS live render (no chrome-devtools). Note in the report that it needs: two tabs with correct counts, 24/page pagination prev/next, 碑帖 framed cards, hide + delete on a built-in, the 头奖 badge on the rare cat in the 招财猫 tab, per-section upload→preview→commit.

- [ ] **Step 4: Commit**

```bash
git add src/app/gallery/GalleryGrid.tsx
git commit -m "feat(gallery): tabbed + paginated 碑帖 gallery with delete-all + per-section upload"
```

---

## Self-Review

**Spec coverage:**
- `kind` column + seed 38 → Task 1 ✓
- customer picker excludes lucky-cats (`listVisiblePresets` kind filter) → Task 2 ✓
- admin list returns kind + excludes deleted → Task 2 ✓
- soft-delete on all (drop builtin guard) → Task 2 (store) + Task 4 (route) ✓
- commit kind → Task 2 (store) + Task 4 (route) + Task 6 (admin caller/action) ✓
- lucky-cat DB pool + bucket resolver + disk fallback → Task 3 (store) + Task 5 (enqueue) ✓
- rare cat via constant + badge → Task 7 ✓
- tabs + pagination + 碑帖 cards + per-section upload + delete-all UI → Task 7 ✓
- app untouched → no app task ✓
- migration before deploy → Task 1 (deferred apply, controller at deploy) ✓

**Placeholder scan:** No TBD/TODO. Task 7 gives concrete card JSX + the exact state/pagination mechanics; the surrounding preview/commit wiring is "preserved from v1" with the one concrete change (`commitAction(items, tab)`) spelled out — acceptable because that wiring already exists and is only re-parented under the tab.

**Type consistency:** `kind: "gallery" | "lucky_cat"` is identical across store (Task 2/3), route (Task 4), admin caller (Task 6), UI (Task 7). `softDeletePreset` name consistent (Task 2 defines, Task 4 imports). `listLuckyCatPoolHashes`/`getLuckyCatBinarized`/`splitLuckyCatPool`/`luckyCatPool` names consistent across Tasks 3 and 5. `commitGalleryImages(items, createdBy, kind)` arity consistent (Task 6 ↔ Task 7 calls via `commitAction`).

**Risks flagged for execution:**
- Task 5 retains the private `listLuckyCatHashes()` disk scan as the fallback — confirm the implementer does NOT delete it.
- Task 7 `RARE_HASH` is duplicated as a literal in the admin repo (admin can't import from the web repo). Acceptable; comment links it to the source of truth.
- Task 2's supabase mock for `listVisiblePresets` must keep the `.eq("kind","gallery")` ordering compatible with the real chain — the test asserts membership, not order, so it's robust.
