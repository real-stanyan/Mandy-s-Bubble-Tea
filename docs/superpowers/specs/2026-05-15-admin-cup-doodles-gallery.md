# Admin Cup Doodles Gallery

**Date:** 2026-05-15
**Repos:** `mandys_bubble_tea` (web — store color originals) · `mandys_bubble_tea_admin` (UI)

## Why

Customers submit doodles via AI prompt or photo upload; the printed
cup labels are 1-bit Atkinson-dithered. The owner wants a record of
the **color originals** people are actually sending — to see what
customers are creating, spot funny prompts, or just enjoy the work.

## What

A new admin page `/cup-doodles` showing a grid of:

- **The middle band image only** (the doodle area — not the
  printed label with top sticker number / bottom modifier band)
- **Color original** (Doubao raw output for AI, raw upload for
  photo) — not the 1-bit binarized printed version
- Per-image metadata: drink name, sticker number, cup index,
  printed-at timestamp, source type, AI prompt (if any), customer
  first name (if signed-in)

Pagination: ~24 / page, newest first.

## Scope

| Source | In v1? | Reason |
|---|---|---|
| **AI** (Doubao) | ✅ | Color original = Doubao output before binarize |
| **Photo upload** | ✅ | Color original = raw user upload before binarize |
| **Drawn** | ❌ | SVG paths only, never had a "color" original (B&W lines). Easy to add later by rendering the SVG to PNG on demand. |
| **Preset** | ❌ | POOL library, not customer content. Pointless to show. |
| **Fortune** (POS) | ❌ | Text only, no image. |

## Schema changes

`cup_label_ai_jobs`:
- ADD `original_png_path text` — Doubao raw color output

New tracker for photo uploads (currently nothing tracks them):
```
create table cup_label_upload_jobs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  original_path text not null,
  processed_path text not null,
  created_at    timestamptz not null default now()
);
```

`cup_label_jobs`:
- ADD `original_image_path text` — populated at enqueue time
  with whichever color original applies (AI's `original_png_path`
  or upload's `original_path`). Single field, simpler admin query.

## Pipeline edits (web)

- **`ai-process.ts`** — before the binarize step, upload the raw
  Doubao PNG as `{userId}/ai-originals/{jobId}.png`. Record on
  `cup_label_ai_jobs.original_png_path`.
- **`upload-image/route.ts`** — same idea. Save the user's raw
  upload as `{userId}/uploads-originals/{uploadedDoodleId}.png`
  before resize+binarize. INSERT a `cup_label_upload_jobs` row.
- **`enqueue.ts`** — when emitting an AI cup, also look up the
  `original_png_path`; when emitting an upload cup, look up the
  upload row's `original_path`. Write `cup_label_jobs.original_image_path`.
  (Drawn/preset/fortune cups leave it NULL.)

No change to print path — the 1-bit binarized version is still
what goes into `zpl_body` and reaches the printer.

## Admin UI

`mandys_bubble_tea_admin/src/app/cup-doodles/page.tsx`:
- Server component, `dynamic = "force-dynamic"`, auth via existing
  `getAuthedAdmin`.
- Query: cup_label_jobs WHERE original_image_path IS NOT NULL,
  ORDER BY created_at DESC, paginated.
- LEFT JOIN cup_label_ai_jobs (on… see below) so AI cups show
  the customer's prompt.
- Render: tailwind grid, image cards.

**Linking AI metadata to cup_label_jobs**: cup_label_jobs has no
aiDoodleId column right now. Two options:

1. Match by `original_image_path` LIKE `%/ai/{ai_job_id}.png` (hacky).
2. ADD `ai_job_id uuid` to cup_label_jobs at enqueue time.

→ **Option 2** is the right move (one indexed lookup, clear FK).
Migration adds `ai_job_id uuid references cup_label_ai_jobs(id)`.

## Files touched (estimate)

```
NEW supabase/migrations/2026-05-15-cup-doodle-originals.sql
NEW src/lib/cup-label/upload-jobs.ts                (insert/load tracker)
MOD src/lib/cup-label/ai-process.ts                  (save color original)
MOD src/app/api/cup-label/upload-image/route.ts      (save color original + tracker insert)
MOD src/lib/cup-label/enqueue.ts                     (write original_image_path + ai_job_id)
NEW mandys_bubble_tea_admin/src/app/cup-doodles/page.tsx
NEW mandys_bubble_tea_admin/src/app/cup-doodles/CupDoodlesGrid.tsx
NEW mandys_bubble_tea_admin/src/lib/cup-doodles.ts   (server-side query helper)
```

Estimated effort: 4-6 hours.

## Open questions

- Pagination: cursor-based by `created_at` (handles new rows
  arriving mid-browse) vs offset-based (simpler). → **offset**, this
  is admin internal — concurrent paging is rare.
- Should drawn doodles be added? → not in v1; defer until owner asks.
- Should we backfill originals for already-printed AI/upload cups
  pre-cutover? → **no** — those raw Doubao URLs already expired and
  raw upload buffers were discarded. The gallery starts empty and
  fills up from PR #9 merge onwards.
