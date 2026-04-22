-- Robustness additions to print_jobs:
--   * 'printing' status so handleJob can claim a job atomically
--     (guards against duplicate prints when two printer-clients
--      subscribe to the same INSERT event).
--   * claimed_by: which device currently owns a printing row.
--   * printed_cup_count: per-cup progress, so a client that crashes
--     mid-order can resume on restart instead of reprinting cups
--     that already emitted.

alter table print_jobs
  drop constraint if exists print_jobs_status_check;

alter table print_jobs
  add constraint print_jobs_status_check
  check (status in ('pending', 'printing', 'printed', 'failed', 'stale'));

alter table print_jobs
  add column if not exists claimed_by text;

alter table print_jobs
  add column if not exists printed_cup_count integer not null default 0;

-- Partial index for stuck-claim cleanup (claims older than N minutes
-- that never transitioned to 'printed' or 'failed').
create index if not exists print_jobs_printing_claimed_at_idx
  on print_jobs (status, created_at) where status = 'printing';
