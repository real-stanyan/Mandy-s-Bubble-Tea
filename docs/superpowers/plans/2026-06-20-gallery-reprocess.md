# Gallery Re-process Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admin re-binarize any gallery preset via one-tap recipes (images with a color source) or by re-uploading a fresh source (the 38 lucky-cats with no source), with the new artifact going live to web + print immediately.

**Architecture:** Disk `binarized.png` stays an immutable seed; re-processed output is written to the Supabase `cup-label-gallery` bucket under the preset's existing hash and flagged by a new `override_at` column. Read paths (thumbnail, gallery print, lucky-cat print) prefer the bucket when `override_at` is set, else fall back to disk. The preset's hash never changes, so identity (including the jackpot cat) is stable.

**Tech Stack:** Next.js (App Router, `runtime=nodejs`), TypeScript, Vitest 4, sharp, Supabase JS (service-role). Admin is a separate Next.js app that calls the web app server-to-server with a Bearer token.

**Repos:**
- Web (most work): `/Users/stanyan/Github/mandys_bubble_tea` — worktree `.claude/worktrees/gallery-reprocess`, branch `feat/gallery-reprocess`.
- Admin (Tasks 6–7): `/Users/stanyan/Github/mandys_bubble_tea_admin` — branch off its `main`.

## Global Constraints

- hash = md5 of original bytes = preset identity. **Re-processing NEVER recomputes the hash** — same hash, swapped artifact. Re-uploading the jackpot cat MUST preserve `RARE_LUCKY_CAT_HASH`.
- `override_at` flag is meaningful ONLY for `source='builtin'`. Uploads already read from the bucket; re-binarizing an upload just upserts its bucket `binarized.png` in place (no flag, no read-path change).
- Print paths must degrade gracefully: if the override lookup throws (Supabase outage), fall back to the disk seed. An order must NEVER be blocked by a failed override lookup.
- Recipe `run()` output is a 592×592 1-bit PNG (same contract as `binarizeForThermal`). `DOODLE_SIZE = 592`.
- Reuse the already-validated thermal pipelines `valueChannelPng` (drop saturated bg) and `inkLineBinarized` (line extraction) from `scripts/process-lucky-cat-gallery.ts` — extract, do not reinvent.
- Web tests: `npx vitest run <file>`; vitest include glob is `src/**/*.test.ts`. Bucket/DB are mocked via `vi.mock("@/lib/supabase-server")` (see existing `gallery-store.test.ts`, `enqueue.test.ts` for the mock shape).
- Auth on every web admin API: `isAuthedGalleryAdmin(request)` → `{ ok:false, reason:"unconfigured" }` ⇒ 500, other ⇒ 401.

---

## File Structure

**Web (`src/`):**
- `lib/cup-label/recipes.ts` — **NEW.** `RECIPES` registry (5 recipes), `colorThumb(src)`, exported `valueChannelPng`/`inkLineBinarized`. One responsibility: image→1-bit transforms.
- `lib/cup-label/gallery-store.ts` — extend: `override_at` in row type + selects; `thumbUrlFor` honors override; `setOverride`/`clearOverride`/`listPresetOverrides`/`loadBuiltinColorSource` helpers; `listLuckyCatPoolHashes` returns override set; `getLuckyCatBinarized`/`downloadBucketBinarized` unchanged signatures + override-aware variant.
- `lib/cup-label/enqueue.ts` — `resolvePresetBuffer`/lucky-cat draw honor override; batched override lookup; graceful degrade.
- `app/api/admin/gallery/reprocess/route.ts` — **NEW.** preview + commit.
- `app/api/admin/gallery/[hash]/override/route.ts` — **NEW.** DELETE = restore default.
- `app/api/admin/gallery/route.ts` — list returns `hasOverride`.
- `scripts/process-lucky-cat-gallery.ts` — import pipelines from `recipes.ts` (no behavior change).
- `supabase/migrations/2026-06-20-gallery-presets-override.sql` — **NEW.**

**Admin (`src/`):**
- `lib/gallery.ts` — `AdminPreset.hasOverride`; `reprocessPreview`/`reprocessCommit`/`restoreDefault` callers.
- `app/gallery/actions.ts` — `reprocessAction`/`restoreDefaultAction`.
- `app/gallery/GalleryGrid.tsx` — 「图片处理」modal per card.

---

## Task 1: DB migration + store override flag (read exposure)

**Files:**
- Create: `supabase/migrations/2026-06-20-gallery-presets-override.sql`
- Modify: `src/lib/cup-label/gallery-store.ts`
- Test: `src/lib/cup-label/gallery-store.override.test.ts`

**Interfaces:**
- Consumes: existing `DbRow`, `thumbUrlFor`, `BUCKET`, `getSupabaseAdmin`.
- Produces:
  - `thumbUrlFor(p: Pick<GalleryPreset,"hash"|"source"> & { kind?: "gallery"|"lucky_cat"; hasOverride?: boolean }): string` — builtin **and** `hasOverride` → bucket `binarized.png` public URL; builtin no override → disk; upload → bucket `color.png`.
  - `AdminRow` now includes `override_at: string | null`; `listAllForAdmin()` items gain `hasOverride: boolean`.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/2026-06-20-gallery-presets-override.sql
-- Re-processed built-ins store their canonical binarized.png in the
-- cup-label-gallery bucket; override_at non-null = bucket supersedes disk.
alter table gallery_presets
  add column if not exists override_at timestamptz default null;
```

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/cup-label/gallery-store.override.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  getSupabaseAdmin: vi.fn(() => ({
    storage: {
      from: () => ({
        getPublicUrl: (p: string) => ({ data: { publicUrl: `https://buck/${p}` } }),
      }),
    },
  })),
}));

import { thumbUrlFor } from "./gallery-store";

describe("thumbUrlFor override", () => {
  it("builtin without override → disk seed", () => {
    expect(thumbUrlFor({ hash: "abc", source: "builtin", kind: "gallery" }))
      .toBe("/cup-label/gallery/abc/binarized.png");
  });
  it("builtin lucky_cat without override → lucky-cat disk dir", () => {
    expect(thumbUrlFor({ hash: "cat", source: "builtin", kind: "lucky_cat" }))
      .toBe("/cup-label/lucky-cat/cat/binarized.png");
  });
  it("builtin WITH override → bucket binarized.png", () => {
    expect(thumbUrlFor({ hash: "abc", source: "builtin", kind: "gallery", hasOverride: true }))
      .toBe("https://buck/abc/binarized.png");
  });
  it("upload → bucket color.png (override ignored)", () => {
    expect(thumbUrlFor({ hash: "up", source: "upload", hasOverride: true }))
      .toBe("https://buck/up/color.png");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/cup-label/gallery-store.override.test.ts`
Expected: FAIL — the override case returns the disk path (override param not yet honored).

- [ ] **Step 4: Update `thumbUrlFor` + `listAllForAdmin`**

Replace `thumbUrlFor` (currently lines 25–36):

```ts
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
```

In `listAllForAdmin` (currently lines 55–66): add `override_at` to the select and map `hasOverride`:

```ts
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
```

In `listVisiblePresets` (customer picker) add `override_at` to the select and pass it to `thumbUrlFor` so an overridden gallery built-in shows the new art:

```ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/cup-label/gallery-store.override.test.ts`
Expected: PASS (4/4).

- [ ] **Step 6: Run the existing store tests to confirm no regression**

Run: `npx vitest run src/lib/cup-label/gallery-store.test.ts src/lib/cup-label/gallery-store.v2.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/2026-06-20-gallery-presets-override.sql src/lib/cup-label/gallery-store.ts src/lib/cup-label/gallery-store.override.test.ts
git commit -m "feat(gallery): override_at column + thumbUrl honors override"
```

---

## Task 2: Recipes module (extract + extend pipelines)

**Files:**
- Create: `src/lib/cup-label/recipes.ts`
- Modify: `scripts/process-lucky-cat-gallery.ts` (import shared pipelines)
- Test: `src/lib/cup-label/recipes.test.ts`

**Interfaces:**
- Consumes: `binarizeForThermal`, `DOODLE_SIZE` from `@/lib/doodle/binarize`; sharp.
- Produces:
  - `export type RecipeId = "default" | "high-contrast" | "bolder" | "ink-line" | "drop-bg";`
  - `export const RECIPES: ReadonlyArray<{ id: RecipeId; label: string; run(src: Buffer): Promise<Buffer> }>` (order = display order).
  - `export function getRecipe(id: string): { id: RecipeId; label: string; run(src: Buffer): Promise<Buffer> } | null`
  - `export async function colorThumb(src: Buffer): Promise<Buffer>` — 480px color PNG (same as current `processGalleryImage` color step).
  - `export async function valueChannelPng(src: Buffer): Promise<Buffer>`, `export async function inkLineBinarized(src: Buffer): Promise<Buffer>` (moved from the script verbatim).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/cup-label/recipes.test.ts
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { RECIPES, getRecipe, colorThumb } from "./recipes";

// A small synthetic source: 200x200, left half black, right half saturated red.
async function sampleSource(): Promise<Buffer> {
  const w = 200, h = 200;
  const buf = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    if (x < w / 2) { buf[i] = 0; buf[i + 1] = 0; buf[i + 2] = 0; }
    else { buf[i] = 220; buf[i + 1] = 20; buf[i + 2] = 20; }
  }
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

describe("RECIPES", () => {
  it("exposes 5 recipes in stable order", () => {
    expect(RECIPES.map((r) => r.id)).toEqual(["default", "high-contrast", "bolder", "ink-line", "drop-bg"]);
  });

  it("every recipe returns a 592x592 single-channel PNG", async () => {
    const src = await sampleSource();
    for (const r of RECIPES) {
      const out = await r.run(src);
      const meta = await sharp(out).metadata();
      expect(meta.width, r.id).toBe(592);
      expect(meta.height, r.id).toBe(592);
    }
  });

  it("recipes produce genuinely different output (not all identical)", async () => {
    const src = await sampleSource();
    const def = (await getRecipe("default")!.run(src)).toString("base64");
    const drop = (await getRecipe("drop-bg")!.run(src)).toString("base64");
    expect(def).not.toBe(drop);
  });

  it("getRecipe returns null for unknown id", () => {
    expect(getRecipe("nope")).toBeNull();
  });

  it("colorThumb fits within 480px", async () => {
    const src = await sampleSource();
    const meta = await sharp(await colorThumb(src)).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(480);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/cup-label/recipes.test.ts`
Expected: FAIL — `./recipes` does not exist.

- [ ] **Step 3: Implement `recipes.ts`**

Move `valueChannelPng` + `inkLineBinarized` verbatim from `scripts/process-lucky-cat-gallery.ts` (lines 53–105, including the `INK_LINE_THRESHOLD = 70` and value-channel `THRESHOLD = 200` constants), then add the registry. `high-contrast` and `bolder` are sharp pre-processing before `binarizeForThermal({mode:"atkinson"})`:

```ts
// src/lib/cup-label/recipes.ts
import "server-only";
import sharp from "sharp";
import { binarizeForThermal, DOODLE_SIZE } from "@/lib/doodle/binarize";

const VALUE_CHANNEL_THRESHOLD = 200;
const INK_LINE_THRESHOLD = 70;

export async function valueChannelPng(src: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(src)
    .resize({ width: DOODLE_SIZE, height: DOODLE_SIZE, fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = info.width * info.height;
  const out = Buffer.alloc(px * 3);
  for (let i = 0; i < px; i++) {
    const v = Math.max(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]);
    out[i * 3] = v; out[i * 3 + 1] = v; out[i * 3 + 2] = v;
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer();
}

export async function inkLineBinarized(src: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(src)
    .resize({ width: DOODLE_SIZE, height: DOODLE_SIZE, fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .removeAlpha().grayscale().blur(0.6).raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height);
  for (let i = 0; i < out.length; i++) out[i] = data[i] < INK_LINE_THRESHOLD ? 0 : 255;
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 1 } }).median(3).png().toBuffer();
}

// Pre-stretch contrast (auto levels) then dither — recovers faded/low-contrast scans.
async function highContrast(src: Buffer): Promise<Buffer> {
  const pre = await sharp(src).normalise().png().toBuffer();
  return binarizeForThermal(pre, { mode: "atkinson" });
}

// Darken before dither so more pixels cross to black — bolder, thicker lines.
async function bolder(src: Buffer): Promise<Buffer> {
  const pre = await sharp(src).linear(1.1, -28).png().toBuffer();
  return binarizeForThermal(pre, { mode: "atkinson" });
}

export type RecipeId = "default" | "high-contrast" | "bolder" | "ink-line" | "drop-bg";

export const RECIPES: ReadonlyArray<{ id: RecipeId; label: string; run(src: Buffer): Promise<Buffer> }> = [
  { id: "default", label: "默认", run: (s) => binarizeForThermal(s, { mode: "atkinson" }) },
  { id: "high-contrast", label: "高对比", run: highContrast },
  { id: "bolder", label: "加重", run: bolder },
  { id: "ink-line", label: "线稿提取", run: inkLineBinarized },
  { id: "drop-bg", label: "去彩底", run: async (s) => binarizeForThermal(await valueChannelPng(s), { mode: "threshold", threshold: VALUE_CHANNEL_THRESHOLD }) },
];

export function getRecipe(id: string): (typeof RECIPES)[number] | null {
  return RECIPES.find((r) => r.id === id) ?? null;
}

export async function colorThumb(src: Buffer): Promise<Buffer> {
  return sharp(src)
    .resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/cup-label/recipes.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Refactor the lucky-cat script to import the shared pipelines**

In `scripts/process-lucky-cat-gallery.ts`: delete the local `valueChannelPng` and `inkLineBinarized` definitions (lines 53–105) and the now-unused `INK_LINE_THRESHOLD`/local constants, and import instead:

```ts
import { valueChannelPng, inkLineBinarized } from "../src/lib/cup-label/recipes";
```

Keep the script's `THRESHOLD = 200` use in its `binarizeForThermal(..., { mode:"threshold", threshold: THRESHOLD })` call unchanged (matches `VALUE_CHANNEL_THRESHOLD`). Do not change the script's output logic.

- [ ] **Step 6: Verify the script still type-checks**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "process-lucky-cat\|recipes" || echo "no type errors in touched files"`
Expected: `no type errors in touched files`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/cup-label/recipes.ts src/lib/cup-label/recipes.test.ts scripts/process-lucky-cat-gallery.ts
git commit -m "feat(gallery): shared recipes module (5 one-tap recipes)"
```

---

## Task 3: Store helpers for reprocess (source load + override write)

**Files:**
- Modify: `src/lib/cup-label/gallery-store.ts`
- Test: `src/lib/cup-label/gallery-store.reprocess.test.ts`

**Interfaces:**
- Consumes: `getSupabaseAdmin`, `BUCKET`, `fs`, `path`, `GALLERY_DIR`/`LUCKY_CAT_DIR`.
- Produces:
  - `loadSourceColor(hash: string): Promise<Buffer | null>` — returns the existing color source for a preset: builtin gallery → disk `gallery/<hash>/color.png`; else → bucket `<hash>/color.png`; returns `null` if none exists (e.g. builtin lucky-cat with no source).
  - `setOverride(hash: string): Promise<void>` — `update gallery_presets set override_at=now() where hash=?`.
  - `clearOverride(hash: string): Promise<{ ok: boolean; reason?: "not_found" }>` — set `override_at=null`; only succeeds for `source='builtin'`.
  - `listPresetOverrides(hashes: string[]): Promise<Set<string>>` — batched; the hashes whose `override_at is not null`. Empty Set on empty input.

> Note: there is no `GALLERY_DIR` constant in `gallery-store.ts` yet — add `const GALLERY_DIR = path.join(process.cwd(), "public", "cup-label", "gallery");` next to the existing `LUCKY_CAT_DIR`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/cup-label/gallery-store.reprocess.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const updateMock = vi.fn();
const eqMock = vi.fn();
const selectMock = vi.fn();
const downloadMock = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  getSupabaseAdmin: vi.fn(() => ({
    from: () => ({
      update: (v: unknown) => { updateMock(v); return { eq: (...a: unknown[]) => { eqMock(...a); return Promise.resolve({ error: null }); } }; },
      select: (...a: unknown[]) => { selectMock(...a); return { in: (_c: string, hs: string[]) => Promise.resolve({ data: hs.filter((h) => h === "ov").map((h) => ({ hash: h })), error: null }) }; },
    }),
    storage: { from: () => ({ download: downloadMock }) },
  })),
}));

import { setOverride, listPresetOverrides } from "./gallery-store";

beforeEach(() => { updateMock.mockClear(); eqMock.mockClear(); });

describe("override write helpers", () => {
  it("setOverride sets override_at and filters by hash", async () => {
    await setOverride("abc");
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ override_at: expect.any(String) }));
    expect(eqMock).toHaveBeenCalledWith("hash", "abc");
  });

  it("listPresetOverrides returns only overridden hashes", async () => {
    const set = await listPresetOverrides(["ov", "plain"]);
    expect(set.has("ov")).toBe(true);
    expect(set.has("plain")).toBe(false);
  });

  it("listPresetOverrides short-circuits on empty input", async () => {
    selectMock.mockClear();
    const set = await listPresetOverrides([]);
    expect(set.size).toBe(0);
    expect(selectMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/cup-label/gallery-store.reprocess.test.ts`
Expected: FAIL — `setOverride`/`listPresetOverrides` not exported.

- [ ] **Step 3: Implement helpers in `gallery-store.ts`**

Add near the top (after `LUCKY_CAT_DIR`): `const GALLERY_DIR = path.join(process.cwd(), "public", "cup-label", "gallery");`

Append:

```ts
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
```

> The test's `select().in()` mock omits `.not()`; chain `.not("override_at","is",null)` before `.in(...)`. Adjust the test mock's `select` to return `{ not: () => ({ in: ... }) }`. Update the test in Step 1 accordingly before running — OR implement `listPresetOverrides` with `.in(...)` first then `.not(...)`; pick one chain order and make test + impl agree. **Implementer: make the mock match your final chain.**

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/cup-label/gallery-store.reprocess.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add src/lib/cup-label/gallery-store.ts src/lib/cup-label/gallery-store.reprocess.test.ts
git commit -m "feat(gallery): store helpers loadSourceColor/setOverride/clearOverride/listPresetOverrides"
```

---

## Task 4: Reprocess API (preview + commit) + restore-default route + list `hasOverride`

**Files:**
- Create: `src/app/api/admin/gallery/reprocess/route.ts`
- Create: `src/app/api/admin/gallery/[hash]/override/route.ts`
- Modify: `src/app/api/admin/gallery/route.ts` (already returns `listAllForAdmin()` items which now carry `hasOverride` — no code change needed; verify in test)
- Test: `src/lib/cup-label/reprocess-api.test.ts` (unit-test the route handlers directly)

**Interfaces:**
- Consumes: `isAuthedGalleryAdmin`, `getRecipe`, `colorThumb`, `loadSourceColor`, `uploadBucketArtifacts`, `setOverride`, `clearOverride`.
- Produces: `POST /api/admin/gallery/reprocess` body `{ hash: string; recipeId: string; image?: string; commit?: boolean }`:
  - resolve source: `image` present → decode it; else → `loadSourceColor(hash)`; null → `400 { ok:false, reason:"needs_upload" }`.
  - `binarized = await getRecipe(recipeId).run(source)`; unknown recipe → `400 { reason:"bad_recipe" }`.
  - `commit !== true` (preview): return `{ ok:true, binarizedDataUrl, colorDataUrl }` (colorDataUrl from `colorThumb(source)`); write nothing.
  - `commit === true`: `await uploadBucketArtifacts(hash, await colorThumb(source), binarized)`; `await setOverride(hash)`; return `{ ok:true, hash }`.
  - `DELETE /api/admin/gallery/[hash]/override` → `clearOverride(hash)`; 404 if not_found.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/cup-label/reprocess-api.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/cup-label/gallery-admin-auth", () => ({
  isAuthedGalleryAdmin: vi.fn(() => ({ ok: true })),
}));
const uploadArtifacts = vi.fn().mockResolvedValue(undefined);
const setOverrideMock = vi.fn().mockResolvedValue(undefined);
const loadSource = vi.fn();
vi.mock("@/lib/cup-label/gallery-store", () => ({
  uploadBucketArtifacts: (...a: unknown[]) => uploadArtifacts(...a),
  setOverride: (...a: unknown[]) => setOverrideMock(...a),
  loadSourceColor: (...a: unknown[]) => loadSource(...a),
}));
// Recipe + colorThumb return tiny fixed buffers so we assert flow, not pixels.
vi.mock("@/lib/cup-label/recipes", () => ({
  getRecipe: (id: string) => (id === "default" ? { id, label: "默认", run: async () => Buffer.from("BIN") } : null),
  colorThumb: async () => Buffer.from("COL"),
}));

import { POST } from "@/app/api/admin/gallery/reprocess/route";

function req(body: unknown) {
  return new Request("http://x/api/admin/gallery/reprocess", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

beforeEach(() => { uploadArtifacts.mockClear(); setOverrideMock.mockClear(); loadSource.mockReset(); });

describe("reprocess route", () => {
  it("preview from existing source writes nothing", async () => {
    loadSource.mockResolvedValue(Buffer.from("SRC"));
    const res = await POST(req({ hash: "abc", recipeId: "default" }));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.binarizedDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(uploadArtifacts).not.toHaveBeenCalled();
    expect(setOverrideMock).not.toHaveBeenCalled();
  });

  it("commit writes bucket artifacts then sets override", async () => {
    loadSource.mockResolvedValue(Buffer.from("SRC"));
    const res = await POST(req({ hash: "abc", recipeId: "default", commit: true }));
    expect((await res.json()).ok).toBe(true);
    expect(uploadArtifacts).toHaveBeenCalledWith("abc", Buffer.from("COL"), Buffer.from("BIN"));
    expect(setOverrideMock).toHaveBeenCalledWith("abc");
  });

  it("built-in cat with no source → 400 needs_upload", async () => {
    loadSource.mockResolvedValue(null);
    const res = await POST(req({ hash: "cat", recipeId: "default" }));
    expect(res.status).toBe(400);
    expect((await res.json()).reason).toBe("needs_upload");
  });

  it("uploaded image is used as source (no loadSourceColor)", async () => {
    const res = await POST(req({ hash: "cat", recipeId: "default", image: "data:image/png;base64,QUJD", commit: true }));
    expect((await res.json()).ok).toBe(true);
    expect(loadSource).not.toHaveBeenCalled();
    expect(uploadArtifacts).toHaveBeenCalled();
  });

  it("unknown recipe → 400 bad_recipe", async () => {
    loadSource.mockResolvedValue(Buffer.from("SRC"));
    const res = await POST(req({ hash: "abc", recipeId: "nope" }));
    expect(res.status).toBe(400);
    expect((await res.json()).reason).toBe("bad_recipe");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/cup-label/reprocess-api.test.ts`
Expected: FAIL — route module does not exist.

- [ ] **Step 3: Implement `reprocess/route.ts`**

```ts
// src/app/api/admin/gallery/reprocess/route.ts
import { NextResponse } from "next/server";
import { isAuthedGalleryAdmin } from "@/lib/cup-label/gallery-admin-auth";
import { getRecipe, colorThumb } from "@/lib/cup-label/recipes";
import { loadSourceColor, uploadBucketArtifacts, setOverride } from "@/lib/cup-label/gallery-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024;

function decode(input: string): Buffer {
  const m = input.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  return Buffer.from(m ? m[1] : input, "base64");
}

export async function POST(request: Request) {
  const auth = isAuthedGalleryAdmin(request);
  if (!auth.ok) return NextResponse.json({ ok: false, reason: auth.reason }, { status: auth.reason === "unconfigured" ? 500 : 401 });

  const body = (await request.json().catch(() => null)) as
    | { hash?: string; recipeId?: string; image?: string; commit?: boolean }
    | null;
  if (!body?.hash || typeof body.hash !== "string") return NextResponse.json({ ok: false, error: "hash required" }, { status: 400 });

  const recipe = getRecipe(body.recipeId ?? "");
  if (!recipe) return NextResponse.json({ ok: false, reason: "bad_recipe" }, { status: 400 });

  let source: Buffer | null;
  if (typeof body.image === "string" && body.image.length > 0) {
    source = decode(body.image);
    if (source.length === 0 || source.length > MAX_BYTES) return NextResponse.json({ ok: false, error: "bad image" }, { status: 400 });
  } else {
    source = await loadSourceColor(body.hash);
  }
  if (!source) return NextResponse.json({ ok: false, reason: "needs_upload" }, { status: 400 });

  let binarized: Buffer, color: Buffer;
  try {
    binarized = await recipe.run(source);
    color = await colorThumb(source);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "processing failed" }, { status: 500 });
  }

  if (body.commit !== true) {
    return NextResponse.json({
      ok: true,
      binarizedDataUrl: `data:image/png;base64,${binarized.toString("base64")}`,
      colorDataUrl: `data:image/png;base64,${color.toString("base64")}`,
    });
  }

  await uploadBucketArtifacts(body.hash, color, binarized);
  await setOverride(body.hash);
  return NextResponse.json({ ok: true, hash: body.hash });
}
```

- [ ] **Step 4: Implement `[hash]/override/route.ts`**

```ts
// src/app/api/admin/gallery/[hash]/override/route.ts
import { NextResponse } from "next/server";
import { isAuthedGalleryAdmin } from "@/lib/cup-label/gallery-admin-auth";
import { clearOverride } from "@/lib/cup-label/gallery-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ hash: string }> };

export async function DELETE(request: Request, ctx: Ctx) {
  const auth = isAuthedGalleryAdmin(request);
  if (!auth.ok) return NextResponse.json({ ok: false, reason: auth.reason }, { status: auth.reason === "unconfigured" ? 500 : 401 });
  const { hash } = await ctx.params;
  const r = await clearOverride(hash);
  if (!r.ok) return NextResponse.json(r, { status: r.reason === "not_found" ? 404 : 500 });
  return NextResponse.json(r);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/cup-label/reprocess-api.test.ts`
Expected: PASS (5/5).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/admin/gallery/reprocess/route.ts "src/app/api/admin/gallery/[hash]/override/route.ts" src/lib/cup-label/reprocess-api.test.ts
git commit -m "feat(gallery): reprocess API (preview/commit) + restore-default route"
```

---

## Task 5: Print paths honor override (gallery + lucky-cat) with graceful degrade

**Files:**
- Modify: `src/lib/cup-label/gallery-store.ts` (`getLuckyCatBinarized` override-aware; `listLuckyCatPoolHashes` returns override set)
- Modify: `src/lib/cup-label/enqueue.ts` (`resolvePresetBuffer` override param; wire override into draw + picked-preset paths; batched lookup; degrade)
- Test: `src/lib/cup-label/enqueue.override.test.ts`

**Interfaces:**
- Consumes: `downloadBucketBinarized`, `listPresetOverrides`.
- Produces:
  - `getLuckyCatBinarized(hash: string, opts?: { hasOverride?: boolean }): Promise<Buffer>` — `hasOverride` → bucket first; else disk-first/bucket-fallback (current).
  - `listLuckyCatPoolHashes(): Promise<{ commons: string[]; hasRare: boolean; overrides: Set<string> }>` — adds `overrides`.
  - `resolvePresetBuffer(hash: string, opts?: { hasOverride?: boolean }): Promise<Buffer>` — `hasOverride` → `downloadBucketBinarized(hash)`; else disk-first/bucket-fallback (current).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/cup-label/enqueue.override.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const readFileMock = vi.fn();
vi.mock("node:fs", () => ({ promises: { readFile: (...a: unknown[]) => readFileMock(...a) } }));
const downloadBin = vi.fn();
vi.mock("./gallery-store", () => ({
  downloadBucketBinarized: (...a: unknown[]) => downloadBin(...a),
  listLuckyCatPoolHashes: vi.fn(),
  getLuckyCatBinarized: vi.fn(),
}));

import { resolvePresetBuffer } from "./enqueue";

beforeEach(() => { readFileMock.mockReset(); downloadBin.mockReset(); });

describe("resolvePresetBuffer override", () => {
  it("override → reads bucket, never disk", async () => {
    downloadBin.mockResolvedValue(Buffer.from("BUCKET"));
    const out = await resolvePresetBuffer("abc", { hasOverride: true });
    expect(out.toString()).toBe("BUCKET");
    expect(readFileMock).not.toHaveBeenCalled();
  });
  it("no override → disk first", async () => {
    readFileMock.mockResolvedValue(Buffer.from("DISK"));
    const out = await resolvePresetBuffer("abc");
    expect(out.toString()).toBe("DISK");
  });
  it("no override, disk miss → bucket fallback", async () => {
    readFileMock.mockRejectedValue(new Error("ENOENT"));
    downloadBin.mockResolvedValue(Buffer.from("BUCKET"));
    const out = await resolvePresetBuffer("abc");
    expect(out.toString()).toBe("BUCKET");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/cup-label/enqueue.override.test.ts`
Expected: FAIL — `resolvePresetBuffer` ignores the `opts` arg.

- [ ] **Step 3: Update `resolvePresetBuffer` (enqueue.ts ~line 179)**

```ts
export async function resolvePresetBuffer(hash: string, opts?: { hasOverride?: boolean }): Promise<Buffer> {
  if (opts?.hasOverride) {
    // Re-processed built-in: canonical print image lives in the bucket.
    return downloadBucketBinarized(hash);
  }
  try {
    return await fs.readFile(path.join(GALLERY_DIR, hash, "binarized.png"));
  } catch {
    return downloadBucketBinarized(hash);
  }
}
```

- [ ] **Step 4: Update `getLuckyCatBinarized` + `listLuckyCatPoolHashes` (gallery-store.ts)**

```ts
export async function getLuckyCatBinarized(hash: string, opts?: { hasOverride?: boolean }): Promise<Buffer> {
  if (opts?.hasOverride) return downloadBucketBinarized(hash);
  try {
    return await fs.readFile(path.join(LUCKY_CAT_DIR, hash, "binarized.png"));
  } catch {
    return downloadBucketBinarized(hash);
  }
}

export async function listLuckyCatPoolHashes(): Promise<{ commons: string[]; hasRare: boolean; overrides: Set<string> }> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("gallery_presets")
    .select("hash,override_at")
    .eq("kind", "lucky_cat")
    .eq("hidden", false)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
  const rows = data as { hash: string; override_at: string | null }[];
  const { commons, hasRare } = splitLuckyCatPool(rows.map((r) => r.hash));
  const overrides = new Set(rows.filter((r) => r.override_at != null).map((r) => r.hash));
  return { commons, hasRare, overrides };
}
```

- [ ] **Step 5: Wire override into enqueue draw + picked-preset call sites**

In `enqueue.ts`:
- `luckyCatPool()` (line ~59) and its `listLuckyCatHashes` disk fallback (line ~41) must now also surface `overrides`. Disk fallback has no DB → `overrides: new Set()`. Return type becomes `{ commons; hasRare; overrides: Set<string> }`.
- At the lucky-cat draw site (line ~358): once a cat `hash` is drawn, call `getLuckyCatBinarized(hash, { hasOverride: luckyCatOverrides.has(hash) })`, where `luckyCatOverrides` is the `overrides` set destructured from `luckyCatPool()` at line ~214.
- For the picked-preset site (line ~410): before the per-cup loop, compute `const presetOverrides = await listPresetOverrides(presetStickerHashes ?? []).catch(() => new Set<string>());` (graceful degrade — DB error ⇒ empty ⇒ disk seed). Then call `resolvePresetBuffer(presetStickerHash, { hasOverride: presetOverrides.has(presetStickerHash) })`. Import `listPresetOverrides` from `./gallery-store`.

Update destructuring at line ~214:
```ts
const { commons: luckyCatCommons, hasRare: luckyCatHasRare, overrides: luckyCatOverrides } =
  await luckyCatPool();
```

- [ ] **Step 6: Run the failing test + the existing lucky-cat/gallery enqueue tests**

Run: `npx vitest run src/lib/cup-label/enqueue.override.test.ts src/lib/cup-label/enqueue.luckycat.test.ts src/lib/cup-label/enqueue.gallery.test.ts src/lib/cup-label/gallery-store.luckycat.test.ts`
Expected: PASS. If the existing tests assert the old `listLuckyCatPoolHashes` shape, update those expectations to include `overrides: new Set()` / destructure the new field — the pool membership and jackpot assertions must remain unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/lib/cup-label/enqueue.ts src/lib/cup-label/gallery-store.ts src/lib/cup-label/enqueue.override.test.ts src/lib/cup-label/enqueue.luckycat.test.ts src/lib/cup-label/enqueue.gallery.test.ts src/lib/cup-label/gallery-store.luckycat.test.ts
git commit -m "feat(gallery): print paths honor override with graceful disk degrade"
```

---

## Task 6: Admin server caller + actions

**Files (admin repo `/Users/stanyan/Github/mandys_bubble_tea_admin`):**
- Modify: `src/lib/gallery.ts`
- Modify: `src/app/gallery/actions.ts`
- Test: `src/lib/gallery.reprocess.test.ts`

**Interfaces:**
- Produces:
  - `AdminPreset` gains `hasOverride: boolean`.
  - `reprocessPreview(hash: string, recipeId: string, image?: string): Promise<{ binarizedDataUrl: string; colorDataUrl: string } | { reason: string }>`
  - `reprocessCommit(hash: string, recipeId: string, image?: string): Promise<{ ok: boolean; hash?: string; reason?: string }>`
  - `restoreDefault(hash: string): Promise<{ ok: boolean; reason?: string }>`
  - server actions `reprocessPreviewAction`, `reprocessCommitAction`, `restoreDefaultAction` (admin-guarded).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/gallery.reprocess.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
beforeEach(() => { fetchMock.mockReset(); process.env.GALLERY_ADMIN_TOKEN = "t"; process.env.NEXT_PUBLIC_WEB_ORIGIN = "https://web"; });

import { reprocessCommit, restoreDefault } from "./gallery";

describe("admin reprocess callers", () => {
  it("reprocessCommit posts hash+recipe+commit to web", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, hash: "abc" }) });
    const r = await reprocessCommit("abc", "default");
    expect(r.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://web/api/admin/gallery/reprocess");
    expect(JSON.parse(init.body)).toMatchObject({ hash: "abc", recipeId: "default", commit: true });
    expect(init.headers.authorization).toBe("Bearer t");
  });

  it("restoreDefault DELETEs the override route", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    await restoreDefault("abc");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://web/api/admin/gallery/abc/override");
    expect(init.method).toBe("DELETE");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from admin repo): `npx vitest run src/lib/gallery.reprocess.test.ts`
Expected: FAIL — exports missing.

- [ ] **Step 3: Implement callers in `src/lib/gallery.ts`**

Add `hasOverride: boolean;` to `AdminPreset`. Append:

```ts
export async function reprocessPreview(hash: string, recipeId: string, image?: string) {
  const res = await fetch(`${getWebOrigin()}/api/admin/gallery/reprocess`, {
    method: "POST", headers: authHeaders(true),
    body: JSON.stringify({ hash, recipeId, image }),
  });
  if (!res.ok && res.status !== 400) throw new Error(`reprocess preview failed: ${res.status}`);
  return (await res.json()) as { binarizedDataUrl: string; colorDataUrl: string } | { reason: string };
}

export async function reprocessCommit(hash: string, recipeId: string, image?: string) {
  const res = await fetch(`${getWebOrigin()}/api/admin/gallery/reprocess`, {
    method: "POST", headers: authHeaders(true),
    body: JSON.stringify({ hash, recipeId, image, commit: true }),
  });
  if (!res.ok && res.status !== 400) throw new Error(`reprocess commit failed: ${res.status}`);
  return (await res.json()) as { ok: boolean; hash?: string; reason?: string };
}

export async function restoreDefault(hash: string) {
  const res = await fetch(`${getWebOrigin()}/api/admin/gallery/${hash}/override`, {
    method: "DELETE", headers: authHeaders(),
  });
  if (!res.ok && res.status !== 404) throw new Error(`restore default failed: ${res.status}`);
  return (await res.json()) as { ok: boolean; reason?: string };
}
```

- [ ] **Step 4: Add actions in `src/app/gallery/actions.ts`**

```ts
export async function reprocessPreviewAction(hash: string, recipeId: string, image?: string) {
  await assertAdmin();
  return reprocessPreview(hash, recipeId, image);
}
export async function reprocessCommitAction(hash: string, recipeId: string, image?: string) {
  await assertAdmin();
  return reprocessCommit(hash, recipeId, image);
}
export async function restoreDefaultAction(hash: string) {
  await assertAdmin();
  return restoreDefault(hash);
}
```

Add the three names to the import from `@/lib/gallery`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/gallery.reprocess.test.ts`
Expected: PASS (2/2). If the admin repo has no vitest configured, instead run `npx tsc --noEmit` and verify no type errors in the touched files, and note the test gap in the report.

- [ ] **Step 6: Commit**

```bash
git add src/lib/gallery.ts src/app/gallery/actions.ts src/lib/gallery.reprocess.test.ts
git commit -m "feat(gallery): admin reprocess/restore server callers + actions"
```

---

## Task 7: Admin UI — 「图片处理」modal

**Files (admin repo):**
- Modify: `src/app/gallery/GalleryGrid.tsx`

**Interfaces:**
- Consumes: `reprocessPreviewAction`, `reprocessCommitAction`, `restoreDefaultAction`, `AdminPreset.hasOverride`, the 5 recipe ids/labels (hard-code the same `[{id,label}]` list as `recipes.ts` — a 5-item literal, not worth a shared import across repos).

- [ ] **Step 1: Add the recipe list constant + modal state**

At the top of `GalleryGrid.tsx` add:

```tsx
const RECIPES = [
  { id: "default", label: "默认" },
  { id: "high-contrast", label: "高对比" },
  { id: "bolder", label: "加重" },
  { id: "ink-line", label: "线稿提取" },
  { id: "drop-bg", label: "去彩底" },
] as const;
```

- [ ] **Step 2: Add a 「图片处理」button to each PresetCard**

In the card action row (next to existing 隐藏/删除), add:

```tsx
<button type="button" onClick={() => setEditing(preset)} className="text-xs text-[#8a6f3a] hover:underline">
  图片处理
</button>
```

`setEditing` opens the modal with the chosen `AdminPreset`.

- [ ] **Step 3: Implement the modal**

A modal component holding: optional file input (「换一张源图」, reads to a data URL via `FileReader`), the 5 recipe buttons, a live preview `<img>` (src = last preview `binarizedDataUrl`), and 保存/恢复默认/取消. Behavior:

- Click a recipe → call `reprocessPreviewAction(editing.hash, recipeId, uploadedDataUrl)`. If result has `reason==="needs_upload"`, show 「请先换一张源图」 and do not set preview. Else set preview to `binarizedDataUrl`.
- 保存 → `reprocessCommitAction(editing.hash, selectedRecipeId, uploadedDataUrl)`; on `ok`, close modal and refresh (`router.refresh()`); on `reason`, surface it.
- 恢复默认 → only render when `editing.source === "builtin"`; calls `restoreDefaultAction(editing.hash)` then refresh.
- For a built-in `lucky_cat` with no prior override, recipe buttons are disabled until a source is uploaded (server would return `needs_upload`); show a hint.

Match the existing 碑帖 card styling (`bg-[#f3ecdc]`, `#8a6f3a` text) and the existing upload-modal pattern already in this file for the file→dataURL plumbing.

- [ ] **Step 4: Verify the build + lint**

Run: `npx tsc --noEmit && npx next lint --file src/app/gallery/GalleryGrid.tsx 2>/dev/null || npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/gallery/GalleryGrid.tsx
git commit -m "feat(gallery): admin 图片处理 modal (recipes + re-upload + restore)"
```

---

## Integration & Deploy (controller steps — not TDD tasks)

After all tasks pass review:

1. **Apply the migration to prod** (service-role can't DDL — use the Supabase Management API with a personal access token, as in v1/v2): `POST https://api.supabase.com/v1/projects/fsvtwivogyebugqhmjjy/database/query` with the `alter table` SQL. Verify: `select count(*) from gallery_presets where override_at is not null;` → 0.
2. **Web full suite:** `npx vitest run` → all green.
3. **Merge web** `feat/gallery-reprocess` → main; Vercel auto-deploys.
4. **Merge admin** branch → main; Vercel auto-deploys.
5. **Prod smoke:** in admin, open a gallery built-in → 图片处理 → 去彩底 → 保存; confirm thumb updates and a test print pulls the new image. Open the screenshot cat `5ac8781655d0aa6b4f6696fa57d2266c` → 换一张源图 → 保存 → confirm it becomes drawable/printable with the new art and its hash is unchanged.
6. **Push to /tester** per the /dev Session End Protocol.

---

## Self-Review Notes

- **Spec coverage:** §2 migration→T1; §2.2 read precedence→T1 (thumb) + T5 (print); §3 recipes→T2; §4.2 API→T4; §4.3 admin caller→T6; §5 UI→T7; §6 invariants→T5 tests + integration smoke; §7 testing→each task's tests. ✓
- **Override only for builtin:** uploads re-binarize in place via the same commit (writes bucket binarized.png + sets override_at, but upload read paths already hit the bucket so the flag is harmless/redundant for them). ✓
- **Jackpot hash stability:** re-upload never recomputes hash (commit takes `hash` as input, never md5s the upload) — covered by T4 test "uploaded image is used as source" + integration smoke step 5. ✓
- **Type consistency:** `getLuckyCatBinarized`/`resolvePresetBuffer` opts `{ hasOverride?: boolean }`; `listLuckyCatPoolHashes` returns `{commons,hasRare,overrides}`; `listPresetOverrides(hashes): Set<string>` — used consistently across T3/T4/T5. ✓
