-- Scheduled pickup: hold a cup-sticker until it's time to make the drinks.
--
-- print_due_at: when the printer-client may claim this job. NULL = due
-- immediately (every ASAP order, and every row from before this column
-- existed — the client treats NULL and past-due identically).
-- pickup_at: the customer's chosen collection time, printed on the sticker
-- so staff can see which waiting cup belongs to whom.
--
-- Additive + idempotent (ADR-0004). Verify object:
--   select count(*) from information_schema.columns
--   where table_name = 'print_jobs' and column_name = 'print_due_at';

alter table public.print_jobs
  add column if not exists print_due_at timestamptz,
  add column if not exists pickup_at timestamptz;

-- The printer-client polls "pending and due"; without an index that scan
-- walks every printed row of history each 8s tick.
create index if not exists print_jobs_pending_due_idx
  on public.print_jobs (status, print_due_at)
  where status = 'pending';
