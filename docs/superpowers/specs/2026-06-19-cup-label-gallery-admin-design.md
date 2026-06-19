# Cup-Label Gallery Admin — Design

**Date:** 2026-06-19
**Status:** Approved (brainstorm) → ready for plan
**Repos touched:** `mandys_bubble_tea` (web, domain owner) · `mandys_bubble_tea_admin` (thin UI) · `mandys_bubble_tea_app` (RN consumer) · Supabase (table + bucket)
**Branch (web):** `feat/cup-label-gallery-admin` off `origin/main` (`ec8e74dd`) — independent of the unmerged `re-design` branch.

## Problem

Staff want an admin page that (1) shows every default cup-label preset currently
offered to customers, and (2) lets them upload new designs that get **appended to
the live gallery**, visible to customers immediately on both web and app.

Today the preset gallery is **235 static PNGs** committed to the web repo at
`public/cup-label/gallery/{hash}/{color,binarized}.png`, indexed by
`public/cup-label/gallery/manifest.json` (content = `{ generatedAt, count, hashes[] }`).
The web `LabelPicker` fetches that manifest at runtime; `enqueue.ts` reads
`binarized.png` from disk at order time; the RN app bundles the images at build
time via `gallery:sync` → `lib/doodle/gallery-manifest.generated.ts`.

**Why a new admin page is not enough:** the admin app is a separate deployment and
cannot write to the web repo's `public/` tree at runtime (Vercel filesystem is
read-only/ephemeral). "Upload → append to live gallery" therefore requires moving
the gallery's **source of truth to a runtime store** (Supabase) and teaching the
web + app consumers to merge the static built-ins with the dynamic uploads.

## Decisions (locked during brainstorm)

1. **Liveness:** new uploads go live on **web + app immediately**. App achieves this
   by **runtime-fetching** the merged gallery (not bundle-on-rebuild).
2. **Upload processing:** staff upload a **raw color image**; the system runs the
   **existing Atkinson dither pipeline** (`binarizeForThermal`) to produce the
   thermal print image, shows a **black-and-white preview**, and only stores on
   explicit confirm. **Batch** (multi-image) supported.
3. **Management scope:** view all · upload-append (batch) · **hide/unhide** (works on
   **both** built-in 235 **and** uploads) · **soft-delete** uploads.
4. **Backend ownership:** **web is the gallery total-owner** (processing, storage,
   merge, print). Admin is a **thin UI** calling web's staff-token API
   (server→server, no CORS). Rationale: print correctness depends on the dither
   matching exactly; keeping all gallery logic in the repo that already owns
   `binarizeForThermal` + `enqueue` eliminates drift.

## Architecture

### Source of truth = Supabase (shared by all three repos)

**New Storage bucket `cup-label-gallery` (public read):**
- `{hash}/color.png` — 480px color thumbnail (what the picker shows)
- `{hash}/binarized.png` — 592×592 1-bit PNG (what prints on the ZD410)

**New table `gallery_presets` (unified — built-ins and uploads in one table):**

| column | type | notes |
|---|---|---|
| `hash` | `text` PK | content MD5 (same scheme as `append-label-gallery.ts`) |
| `source` | `text` | `'builtin'` \| `'upload'` |
| `storage` | `text` | `'static'` (served from web `public/`) \| `'supabase'` (bucket) |
| `hidden` | `boolean` not null default `false` | excluded from customer-facing gallery; applies to built-ins too |
| `sort_order` | `int` not null default `0` | display order; new uploads sort before built-ins |
| `created_at` | `timestamptz` default `now()` | |
| `created_by` | `text` null | admin id (uploads only; null for built-ins) |
| `deleted_at` | `timestamptz` null | soft-delete marker for uploads |

Constraint: `source='builtin' ⇒ storage='static'`; `source='upload' ⇒ storage='supabase'`
(enforced in app logic; optional CHECK in migration).

**Seed migration:** insert the 235 current hashes from `manifest.json`
(`source='builtin'`, `storage='static'`, `hidden=false`, `sort_order` ascending by
manifest index). The static PNGs stay in `public/` untouched — built-in rows merely
*reference* them. This is what makes "hide a built-in" possible (flip `hidden`).

### Write side — web staff-token API (admin server calls these)

Guarded by the existing staff-token pattern (`isAuthedDriver`-style guard, or a
dedicated `GALLERY_ADMIN_TOKEN`; reuse whatever the repush-all endpoint uses). All
routes server-only; admin calls them from its own server route (no browser CORS).

- `POST /api/admin/gallery/preview` — accepts one or more raw images. For each:
  run `binarizeForThermal(raw, { mode: 'atkinson' })` → 592×592 1-bit + color
  resize (1280 inside → 480px thumb), compute content MD5, return
  `{ hash, colorDataUrl, binarizedDataUrl, alreadyExists }` **without persisting**.
  (Preview payloads are transient; staff eyeball the B/W result before committing.)
- `POST /api/admin/gallery/commit` — accepts the **raw image(s)** the staff confirmed
  (client re-sends raw, keyed by the preview `hash`). The server **re-derives**
  `binarizeForThermal` + color from the raw — it never trusts client-supplied
  binarized bytes (print integrity). Writes `{hash}/color.png` + `{hash}/binarized.png`
  to the bucket, inserts `gallery_presets` row (`source='upload'`, `storage='supabase'`).
  Idempotent on `hash` (dedupe). The recomputed hash must match the claimed hash or
  the commit is rejected.
- `PATCH /api/admin/gallery/[hash]` — `{ hidden: boolean }`. Works for built-in and
  upload rows alike.
- `DELETE /api/admin/gallery/[hash]` — **soft delete** an upload: set
  `deleted_at` + `hidden=true`. **Does not** remove bucket files (a printing/just-placed
  order may still reference `binarized.png`). Refuses to delete `source='builtin'`
  (built-ins are hidden, never deleted).
- `GET /api/admin/gallery` — full management list **including** hidden + soft-deleted
  (so the admin grid can show and un-hide them), with thumb URLs.

### Read side — consumption

- **New `GET /api/cup-label/gallery`** (public) — returns the **merged, visible**
  list: `gallery_presets` where `hidden=false AND deleted_at IS NULL`, ordered by
  `sort_order`, as `[{ hash, thumbUrl, source }]`.
  - `source='builtin'` → `thumbUrl = /cup-label/gallery/{hash}/binarized.png` (static)
  - `source='upload'` → `thumbUrl =` bucket public URL for `{hash}/binarized.png`
- **web `LabelPicker.tsx`** — fetch this endpoint instead of the raw `manifest.json`.
  Render thumbnails from `thumbUrl`; on pick still send `{ kind: 'preset', hash }`.
- **web `enqueue.ts`** — when resolving a preset `hash`, look up its `source`:
  - `builtin` → read `public/cup-label/gallery/{hash}/binarized.png` from disk (unchanged).
  - `upload` → download `{hash}/binarized.png` from the bucket (small in-memory/temp
    cache to avoid re-downloading within a print batch).
  - Resolution priority unchanged: `ai > drawn > presetSticker > POOL > hash-default`.
- **RN app** — at picker open, fetch `/api/cup-label/gallery`. Render built-ins from
  the bundled `require` map (`gallery-manifest.generated.ts`, keyed by hash) when
  present; render uploads (and any unbundled hash) from the remote `thumbUrl`.
  Hidden built-ins are already filtered out by the API. The app sends the `hash`;
  printing is server-side via `enqueue`, so the app never needs the binarized bytes.

### Admin page — thin UI

- Route `app/gallery/page.tsx` in `mandys_bubble_tea_admin`, guarded by
  `getAuthedAdmin()` redirect (mirror `cup-doodles/page.tsx`). Add a nav entry to
  `DesktopShell` + `BottomTabBar`.
- Server-side data via a small admin server module that calls web's
  `GET /api/admin/gallery` with the staff token.
- UI: responsive grid of all presets (built-in + upload), hidden ones greyed with an
  "unhide" toggle; a drag/drop + multi-select **batch upload** control → posts to
  web `preview` → shows a B/W preview grid → "确认加入" posts to web `commit`; each
  tile has hide/unhide and (uploads only) delete.

## Components & boundaries

| Unit | Repo | Responsibility | Depends on |
|---|---|---|---|
| `gallery_presets` table + bucket | Supabase | source of truth | — |
| `lib/cup-label/gallery-store.ts` (new) | web | CRUD over table + bucket; merge/list helpers | Supabase admin client, bucket |
| `lib/cup-label/gallery-process.ts` (new, or inline) | web | raw→{color,binarized,hash} reusing `binarizeForThermal` | `src/lib/doodle/binarize` |
| `api/admin/gallery/*` | web | staff-token write/manage endpoints | gallery-store, gallery-process, staff auth |
| `api/cup-label/gallery` | web | public merged read endpoint | gallery-store |
| `LabelPicker` / `enqueue` edits | web | consume merged gallery + print dual-source | gallery-store / bucket |
| `app/gallery/page.tsx` + admin server caller | admin | UI + proxy to web admin API | `getAuthedAdmin`, staff token |
| app picker fetch + remote render | app | runtime-fetch + render built-in/remote | `/api/cup-label/gallery` |

## Error handling

- Preview: bad/oversized/non-image input → per-file error in the batch result; the
  rest still preview. Stay under a sane size cap (match `upload-image` limits).
- Commit: bucket write failure → row not inserted, surfaced per-hash; partial-batch
  commit is allowed (each hash independent + idempotent).
- Read endpoint: on DB error, **fall back to the static `manifest.json`** so the
  customer picker never hard-fails (degrade to built-ins only).
- enqueue upload-download failure → fall back to the safety-net brand logo
  (existing `binarized.png` default), never block the order.

## Testing

- **web vitest:** gallery-process (raw→hash/binarized determinism), gallery-store
  CRUD (mocked Supabase), `api/admin/gallery/*` (auth gate, preview, commit
  idempotency, hide built-in, soft-delete upload, delete-builtin refused),
  `api/cup-label/gallery` merge + hidden filter + DB-error fallback, enqueue
  dual-source resolution (builtin disk vs upload bucket).
- **dither no-drift check:** run one real source image through the new processing
  path and assert the output matches the existing pipeline (same `binarizeForThermal`
  call → byte-identical), guarding against print regressions.
- **admin:** chrome-devtools real render of the grid, batch-upload preview flow,
  hide/unhide, delete (logged-in admin session).
- **Supabase:** migration applied to prod **before** code deploy (additive table +
  bucket + seed; follows the prod-migration-ahead-of-deploy rule).

## Known trade-offs

- DELETE is soft (hidden + `deleted_at`), bucket files retained — protects
  in-flight/printing orders that reference `binarized.png`.
- The legacy static scripts (`process-label-gallery.ts`, `deploy-gallery.ts`,
  `gallery:sync`) become **legacy**; new presets go through the admin flow. Built-ins
  remain static-served for CDN speed; only uploads live in the bucket.
- App gains a network dependency for the gallery list (was fully bundled); built-ins
  still render offline from the bundle, only uploads need the network.

## Out of scope (YAGNI)

- Categories/tags/search on presets, reordering UI beyond default sort, per-preset
  analytics, migrating the 235 built-ins into the bucket (kept static).
