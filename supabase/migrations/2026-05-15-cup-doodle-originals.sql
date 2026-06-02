-- Color-original storage for the admin cup-doodles gallery (2026-05-15)
-- Spec: docs/superpowers/specs/2026-05-15-admin-cup-doodles-gallery.md
--
--   • cup_label_ai_jobs.original_png_path — Doubao raw output (color
--     2048×2048-ish PNG) saved before the binarize/dither step. The
--     existing `png_path` keeps pointing at the 1-bit printed version.
--   • cup_label_upload_jobs — new tracker for customer photo uploads.
--     Photo upload currently reuses saveAiDoodleUpload + the {userId}/ai/
--     path, so the gallery had nothing to distinguish AI from photo
--     and no place to record the raw color upload. This table fills
--     both gaps; upload-image inserts here and returns the row id as
--     `uploadedDoodleId` (replacing the previous random UUID).
--   • cup_label_jobs.original_image_path — convenience column on the
--     main printed-job row pointing at whichever color original
--     applies to this cup (AI's `original_png_path` or upload's
--     `original_path`). Single field = single admin query (no UNION).
--   • cup_label_jobs.ai_job_id — FK to cup_label_ai_jobs so the admin
--     gallery can join the prompt for AI cups without a hacky path
--     LIKE match.

alter table cup_label_ai_jobs
  add column if not exists original_png_path text;

create table if not exists cup_label_upload_jobs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  original_path   text not null,
  processed_path  text not null,
  created_at      timestamptz not null default now()
);

alter table cup_label_upload_jobs enable row level security;

alter table cup_label_jobs
  add column if not exists original_image_path text;

alter table cup_label_jobs
  add column if not exists ai_job_id uuid references cup_label_ai_jobs(id);

create index if not exists cup_label_jobs_gallery_idx
  on cup_label_jobs (created_at desc)
  where original_image_path is not null;
