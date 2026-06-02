-- Extend cup_label_jobs.doodle_source to include 'fortune' for in-store
-- (Square POS) orders printing a DeepSeek-generated fortune-cookie
-- sentence in the doodle band — see src/lib/cup-label/fortune.ts and
-- the webhook → enqueueCupLabelJobs(mode='pos') path.
-- Previous values 'user' / 'default' / 'ai' still accepted.

alter table cup_label_jobs
  drop constraint if exists cup_label_jobs_doodle_source_check;

alter table cup_label_jobs
  add constraint cup_label_jobs_doodle_source_check
  check (doodle_source in ('user', 'default', 'ai', 'fortune'));
