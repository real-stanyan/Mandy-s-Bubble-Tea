-- Extend cup_label_jobs.doodle_source to include 'ai' for Doubao-generated
-- doodles. Previous values 'user' (drawn) and 'default' (preset/hash pool)
-- still accepted.

alter table cup_label_jobs
  drop constraint if exists cup_label_jobs_doodle_source_check;

alter table cup_label_jobs
  add constraint cup_label_jobs_doodle_source_check
  check (doodle_source in ('user', 'default', 'ai'));
