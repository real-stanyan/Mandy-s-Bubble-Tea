# Cup-Label Gallery Admin v2 — kind split, 碑帖 cards, pagination, delete-all

**Date:** 2026-06-20
**Status:** Approved (brainstorm) → ready for plan
**Builds on:** v1 (`docs/superpowers/specs/2026-06-19-cup-label-gallery-admin-design.md`, merged to main `0fe2bf5f`)
**Repos touched:** `mandys_bubble_tea` (web — store/read/enqueue/admin API) · `mandys_bubble_tea_admin` (UI) · Supabase (column + seed). **App untouched.**
**Branch (web):** `feat/gallery-v2-kind-pagination` off `origin/main` (`0fe2bf5f`), worktree `.claude/worktrees/gallery-v2/`.

## Problem

The v1 admin `/gallery` page shows the 235 user-selectable presets as one long grid with hide (+ delete for uploads only). Stan wants:

1. **Separate the 招财猫 (lucky-cat) default deck from the selectable gallery.** The 38 lucky-cats (`public/cup-label/lucky-cat/`, incl. 1 rare jackpot) are the auto-fill fallback when a customer picks nothing — conceptually distinct from the gallery the customer chooses from. They are currently not shown in admin at all.
2. **Make the lucky-cat deck manageable** (upload / hide / delete) **with real effect on the live random draw** — a hidden cat stops being drawn, an uploaded cat enters the pool.
3. **碑帖-style framed cards + pagination** instead of one infinite grid.
4. **Delete available on all presets** (built-in + upload), not just uploads. Delete = soft-delete (removed from the list everywhere, file retained, recoverable).

Upload to the gallery is **staff/admin** upload (already built in v1) — now per-section. No customer-facing upload.

## Data model

The v1 `gallery_presets` table is the single source of truth. Add one axis:

**Migration `2026-06-20-gallery-presets-kind.sql`:**
```sql
alter table public.gallery_presets
  add column if not exists kind text not null default 'gallery'
  check (kind in ('gallery','lucky_cat'));

create index if not exists gallery_presets_kind_visible_idx
  on public.gallery_presets (kind, sort_order)
  where hidden = false and deleted_at is null;
```
- Existing 235 rows default to `kind='gallery'` (no backfill needed).
- **Seed 38 lucky-cats** (`kind='lucky_cat'`, `source='builtin'`, `storage='static'`, `sort_order` ascending by manifest/dir order) from `public/cup-label/lucky-cat/`.
- The rare jackpot cat needs **no schema** — it's identified by the existing code constant `RARE_LUCKY_CAT_HASH` (`src/lib/cup-label/lucky-cat.ts`). Admin marks it with a badge by comparing hash to that constant.
- Lucky-cat **uploads** reuse the same `cup-label-gallery` bucket at `{hash}/{color,binarized}.png` (content-addressed hashes don't collide); `kind` distinguishes them.

## Web changes (gallery domain owner)

### Store (`gallery-store.ts`)
- `listVisiblePresets()` → add `.eq('kind','gallery')`. **Lucky-cats must never reach the customer picker.**
- `listAllForAdmin()` → **exclude soft-deleted** (`deleted_at IS NULL`), **include hidden**, and return `kind` on each row. So in the admin grid "delete" makes a card disappear while "hide" only greys it. (v1 did not filter deleted here; add the filter.)
- New `listLuckyCatPoolHashes(): Promise<{ commons: string[]; hasRare: boolean }>` — query `kind='lucky_cat' AND hidden=false AND deleted_at IS NULL`; `hasRare` = pool contains `RARE_LUCKY_CAT_HASH`; `commons` = the rest. (Mirrors the current disk-scan shape so enqueue swaps cleanly.)
- New `getLuckyCatBinarized(hash)` resolver — disk-first (`public/cup-label/lucky-cat/{hash}/binarized.png`), fall to bucket (`{hash}/binarized.png`) on miss. (Built-in cats on disk; uploaded cats in bucket.)
- `softDeletePreset(hash)` — **rename of `softDeleteUpload` and drop the `builtin_not_deletable` refusal**: any non-deleted row → set `hidden=true`, `deleted_at=now()`. Returns `{ok:true}` or `{ok:false, reason:'not_found'}`. (Built-ins are soft-deleted too; static files are retained.)
- `insertUploadPreset(hash, createdBy, kind)` — add `kind` param (default `'gallery'`).

### Read endpoint (`/api/cup-label/gallery`)
- Unchanged in shape; now returns only gallery presets because `listVisiblePresets` filters `kind='gallery'`. Static-manifest fallback unchanged (the static manifest is gallery-only anyway).

### Admin API
- `POST /api/admin/gallery/commit` — accept optional `kind` (`'gallery'|'lucky_cat'`, default `'gallery'`); pass to `insertUploadPreset`. Re-derive + hash-match unchanged.
- `GET /api/admin/gallery` — returns rows incl. `kind` (from `listAllForAdmin`).
- `DELETE /api/admin/gallery/[hash]` — now succeeds for built-ins too (calls `softDeletePreset`); the 409 `builtin_not_deletable` branch is removed. 404 on not-found stays.
- `PATCH /api/admin/gallery/[hash]` (hide) — unchanged.

### enqueue lucky-cat fallback (`enqueue.ts`)
- Replace the disk-scan `listLuckyCatHashes()` with a call to the store's `listLuckyCatPoolHashes()` (DB-driven pool). **Resilience:** wrap in try/catch — on DB error, fall back to the existing disk-dir scan so the lucky-cat auto-fill never breaks during a Supabase outage. Rare-cat draw odds + `drawLuckyCatHash` logic unchanged (still keyed off `RARE_LUCKY_CAT_HASH`).
- When a drawn lucky-cat hash is turned into a print buffer, use `getLuckyCatBinarized(hash)` (disk-first → bucket) instead of the hardcoded disk read, so uploaded cats actually print. Any failure still falls through to the existing logo/POOL safety net (order never blocked).

## Admin UI (`/gallery`)

- **Two sections via tabs:** `图库 (N)` and `招财猫 (M)`, counts from the fetched list grouped by `kind`. Each tab paginated independently.
- **碑帖-light framed card** (shared `PresetCard`): rice-paper/cream card background, thin double-line frame, the black sticker centered like an ink rubbing, the hash as a small caption (题记). Reuse Tailwind + existing admin tokens; keep it tasteful, not heavy (no paper texture image / seals).
- **Pagination:** client-side. The admin page fetches the full list once (≈273 rows) and slices per tab; **24 per page**; simple prev/next + page indicator. (Server-side pagination is unnecessary at this size.)
- **Per-card actions:** **隐藏/取消隐藏** (toggle) **and 删除** (soft-delete, with confirm) on **every** card (built-in + upload, both kinds). Hidden cards greyed; deleted cards disappear (router.refresh re-fetches).
- **Per-section upload:** each tab has its own batch-upload control; the gallery tab commits with `kind='gallery'`, the lucky-cat tab with `kind='lucky_cat'`. Preview (raw→B/W) flow unchanged.
- **Rare cat badge:** in the 招财猫 tab, the card whose hash === `RARE_LUCKY_CAT_HASH` gets a "头奖" badge.
- The admin caller (`src/lib/gallery.ts`) keeps the v1 thumbUrl absolutization fix; `AdminPreset` gains `kind`; `commitGalleryImages` gains a `kind` arg.

## Components & boundaries

| Unit | Repo | Change |
|---|---|---|
| migration + lucky-cat seed | Supabase | add `kind`, seed 38 |
| `gallery-store.ts` | web | kind filter, lucky-cat pool + resolver, soft-delete-all, commit kind |
| `/api/cup-label/gallery` | web | (no code change — inherits kind filter) |
| `/api/admin/gallery/*` | web | commit kind, delete-all, list kind |
| `enqueue.ts` | web | lucky-cat pool from DB + bucket resolver + disk fallback |
| `src/lib/gallery.ts` (admin) | admin | `kind` on type + commit |
| `/gallery` page + `GalleryGrid` | admin | tabs, pagination, 碑帖 cards, delete-all, per-section upload, rare badge |

## Error handling

- Lucky-cat pool DB read failure → fall back to disk-dir scan (auto-fill never breaks).
- Drawn lucky-cat binarized missing on disk AND bucket → existing logo/POOL safety net.
- Soft-delete of a not-found hash → 404. Delete is recoverable (files retained).
- Public read unchanged: DB error → static gallery manifest.

## Testing

- **web vitest:** `listVisiblePresets` excludes `kind='lucky_cat'`; `listLuckyCatPoolHashes` (commons/hasRare split, hidden/deleted excluded); `getLuckyCatBinarized` disk-first vs bucket; `softDeletePreset` succeeds for builtin + upload, 404 on missing; commit passes `kind`; admin DELETE built-in now 200 (was 409); enqueue lucky-cat draw uses DB pool + falls back to disk on DB throw (mock).
- **lucky-cat seed:** unit test for the seed-row builder (kind='lucky_cat').
- **admin:** tsc + `npm run build`; chrome-devtools real render — two tabs, pagination prev/next, 碑帖 card look, delete + hide on a built-in, rare badge, per-section upload→preview.
- **migration:** applied to prod **before** code deploy (additive column + index + 38-row seed).

## Known trade-offs / out of scope

- Delete is soft for all (files retained); no hard-delete of bucket files (Stan chose soft-all).
- Tarot (`public/cup-label/tarot/`, disabled) and `logo-doodle` decks are not surfaced — out of scope.
- No customer-facing gallery contribution (upload stays staff-only).
- Rare-cat identity stays a code constant; admins can't designate a different rare cat from the UI.
