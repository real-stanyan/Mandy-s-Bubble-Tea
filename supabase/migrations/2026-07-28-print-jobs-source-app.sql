-- print_jobs.source: widen 'web' | 'pos' to 'web' | 'app' | 'pos'.
--
-- The column was created (2026-04-22) when there was no app, so "not web"
-- meant "in-store POS". Orders now arrive from three places, and the app's
-- were being written as 'pos' — indistinguishable from a walk-in at the
-- counter. That broke channel analysis (#87) and left app orders unhighlighted
-- in the admin prints table, which is the row staff scan to catch online
-- orders they'd otherwise miss.
--
-- Widening a CHECK means dropping and re-adding it; there is no ALTER for it.
-- Nothing is destroyed and nothing is rejected that was accepted before — the
-- new constraint accepts a strict superset. Existing rows are untouched: the
-- historical 'pos' bucket stays a mix of walk-in and app, and cannot be split
-- retroactively from this table (Square still holds the order metadata, so a
-- backfill is possible later with a production Square token).
--
-- ORDERING: this must be applied BEFORE the code that writes 'app' ships.
-- The other way round, every app order's INSERT fails its check and no cup
-- sticker is queued at all.
--
-- Idempotent: drop-if-exists, then add under the new name only when absent.

alter table print_jobs
  drop constraint if exists print_jobs_source_check;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'print_jobs_source_allowed'
  ) then
    alter table print_jobs
      add constraint print_jobs_source_allowed
      check (source in ('web', 'app', 'pos'));
  end if;
end $$;
