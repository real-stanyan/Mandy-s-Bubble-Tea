-- Cup-label perf hardening (2026-05-15)
-- See ~/system/DEV_HANDOFF.md session for the concurrent-orders audit.
--
--   1. `zpl_body` lets the web enqueue write the rendered ZPL inline
--      with the row, killing the Storage `doodles` bucket hop and the
--      partial-state window where the bucket upload succeeded but the
--      row insert failed (or vice-versa).
--   2. `raster_path` becomes nullable so new rows can leave it null
--      while inline `zpl_body` is the source of truth. Existing rows
--      with raster_path stay readable via the storage fallback path.
--   3. `target_printer_kind` lets a future second printer (e.g. a
--      back-of-house ZD410 or the ZD411 retirement bridge) subscribe
--      to a filtered Realtime channel instead of every consumer
--      receiving every INSERT.
--   4. `claim_cup_label_job_by_id` is the missing per-id sibling of
--      `claim_oldest_cup_label_job` — same FOR-UPDATE-flavoured
--      semantics (single-row UPDATE WHERE status='pending' is already
--      atomic in Postgres) but it bumps `attempts` properly so the
--      "alert after 3 failures" logic in printer-client actually fires
--      instead of being stuck at attempts=1 forever (queue.ts bug).

alter table cup_label_jobs
  add column if not exists zpl_body text;

alter table cup_label_jobs
  alter column raster_path drop not null;

alter table cup_label_jobs
  add column if not exists target_printer_kind text not null default 'zd410';

create index if not exists cup_label_jobs_pending_kind_idx
  on cup_label_jobs (target_printer_kind, created_at)
  where status = 'pending';

create or replace function claim_cup_label_job_by_id(p_job_id uuid, p_token text)
returns table (
  id uuid,
  square_order_id text,
  line_id text,
  cup_idx int,
  sticker_number text,
  drink_name text,
  modifiers_text text,
  doodle_source text,
  doodle_pool_key text,
  raster_path text,
  zpl_body text,
  target_printer_kind text,
  status text,
  attempts int,
  last_error text,
  printer_token text,
  created_at timestamptz,
  printed_at timestamptz
)
language plpgsql
as $$
begin
  return query
  update cup_label_jobs j
     set status = 'printing',
         attempts = j.attempts + 1,
         printer_token = p_token
   where j.id = p_job_id
     and j.status = 'pending'
   returning
     j.id, j.square_order_id, j.line_id, j.cup_idx,
     j.sticker_number, j.drink_name, j.modifiers_text,
     j.doodle_source, j.doodle_pool_key, j.raster_path,
     j.zpl_body, j.target_printer_kind,
     j.status, j.attempts, j.last_error, j.printer_token,
     j.created_at, j.printed_at;
end;
$$;
