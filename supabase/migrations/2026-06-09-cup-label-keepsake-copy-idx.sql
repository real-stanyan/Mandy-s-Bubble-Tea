-- Keepsake extra-copy support: a second printed copy of a customised cup
-- label (drink name + modifiers omitted) that staff hand to the customer.
-- copy_idx discriminates primary rows (0) from keepsake copies (1). The
-- old 3-column unique must be dropped or keepsake rows (same 3 cols,
-- different copy_idx) violate it. See docs/superpowers/specs/
-- 2026-06-09-checkout-keepsake-cup-label-design.md

alter table cup_label_jobs
  add column if not exists copy_idx int not null default 0;

alter table cup_label_jobs
  drop constraint if exists cup_label_jobs_square_order_id_line_id_cup_idx_key;

alter table cup_label_jobs
  add constraint cup_label_jobs_order_line_cup_copy_key
  unique (square_order_id, line_id, cup_idx, copy_idx);
