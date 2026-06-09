-- Keepsake go-live, final schema step. Drops the 3-col unique
-- `cup_label_jobs_square_order_id_line_id_cup_idx_key` that the hotfix
-- (2026-06-09-hotfix-restore-3col-cup-label-unique.sql) re-added during the
-- 08:05 UTC incident. Keepsake rows (copy_idx = 1) share the 3-col key
-- (square_order_id, line_id, cup_idx) with their primary (copy_idx = 0) row,
-- so they VIOLATE this constraint — it must go once keepsake is live. The
-- 4-col unique `cup_label_jobs_order_line_cup_copy_key` remains and is what
-- the new enqueue code upserts against (onConflict
-- square_order_id,line_id,cup_idx,copy_idx).
--
-- ⚠️ DEPLOY ORDERING (this is what caused the 08:05 incident — do NOT repeat):
-- apply this ONLY AFTER the enqueue code that upserts with the 4-col onConflict
-- is live in prod. If applied while the deployed code still uses the 3-col
-- onConflict, every cup-label upsert throws 42P10 and the store printer goes
-- silent again.

alter table cup_label_jobs
  drop constraint if exists cup_label_jobs_square_order_id_line_id_cup_idx_key;
