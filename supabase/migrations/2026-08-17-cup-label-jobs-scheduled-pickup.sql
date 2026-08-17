-- Scheduled pickup, on the pipeline that actually prints.
--
-- 2026-08-16's migration put print_due_at / pickup_at on print_jobs (the
-- ZD411 receipt-sticker queue). That queue has had no consumer at the store
-- since 2026-05-22 — the launchd job is disabled and ~19k rows sit pending.
-- The label staff actually make drinks from is cup_label_jobs (ZD410, USB),
-- which printed instantly regardless of pickup time, so the hold was a no-op.
-- Same two columns, same semantics, on the live table. See docs/adr/0011.
--
-- print_due_at: when the printer-client may claim this row. NULL = due
-- immediately (every ASAP order, and every row from before this column
-- existed — the client treats NULL and past-due identically).
-- pickup_at: the customer's chosen collection time, printed on the label so
-- the counter knows when the waiting cup gets collected.
--
-- Additive + idempotent (ADR-0004). Verify object:
--   select count(*) from information_schema.columns
--   where table_name = 'cup_label_jobs'
--     and column_name in ('print_due_at', 'pickup_at');

alter table public.cup_label_jobs
  add column if not exists print_due_at timestamptz,
  add column if not exists pickup_at timestamptz;

-- The consumer's pending SELECTs (replay, poll, heartbeat count, age watch)
-- all carry "and due now"; without an index that predicate walks every
-- printed row of history on each 15s tick.
create index if not exists cup_label_jobs_pending_due_idx
  on public.cup_label_jobs (status, print_due_at)
  where status = 'pending';
