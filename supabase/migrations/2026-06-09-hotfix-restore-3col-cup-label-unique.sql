-- HOTFIX (prod incident 2026-06-09 ~08:05 UTC). Ledger version 20260609083525.
--
-- Mirror of a migration applied to prod out-of-band (via Supabase MCP) to
-- restore service. Recorded here so the repo's schema-as-code stays consistent
-- with prod.
--
-- Context: the keepsake cup-label migration (file
-- supabase/migrations/2026-06-09-cup-label-keepsake-copy-idx.sql, currently on
-- branch feat/checkout-keepsake-cup-label, ledger version 20260609080505) was
-- applied to prod AHEAD of any code deploy. It DROPPED the 3-col unique
-- `cup_label_jobs_square_order_id_line_id_cup_idx_key` and added a 4-col one.
-- But the DEPLOYED enqueue code (this branch, main) still upserts
-- `onConflict: square_order_id,line_id,cup_idx` -> every prod cup-label upsert
-- threw 42P10 (no matching ON CONFLICT constraint) -> zero cup_label_jobs rows
-- created -> the store's cup-label printer went silent for ~31 min (the printer
-- itself was fine; there was simply nothing to enqueue/print).
--
-- This restores the 3-col unique so the deployed code works again. The 4-col
-- unique (cup_label_jobs_order_line_cup_copy_key, from the keepsake migration)
-- also exists in prod; both coexist safely while every row is copy_idx = 0.
--
-- ⚠️ When the keepsake branch finally deploys (code switches to a 4-col
-- onConflict AND starts inserting copy_idx = 1 rows that share the 3-col key),
-- a migration in THAT SAME DEPLOY must DROP this constraint again, or keepsake
-- rows will violate it. Do NOT apply that drop ahead of the code deploy — that
-- ordering mistake is exactly what caused this incident.

alter table cup_label_jobs
  add constraint cup_label_jobs_square_order_id_line_id_cup_idx_key
  unique (square_order_id, line_id, cup_idx);
