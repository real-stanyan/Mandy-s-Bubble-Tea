-- Async AI doodle tracker (2026-05-15)
-- See docs/superpowers/specs/2026-05-15-async-ai-doodle-design.md
--
--   • UNIQUE(user_id, slot_key) is the cost-cap enforcer: a customer
--     can never produce more than one Doubao call for the same cup
--     slot, regardless of how many times they re-submit. The /ai-submit
--     route looks up by (user_id, slot_key) and returns the existing
--     aiDoodleId on a second submission for the same slot.
--   • status flows pending → ready (success) or pending → failed (any
--     error in Doubao / binarize / Storage upload). loadAiDoodleUpload
--     polls this column up to 30s; the enqueue.ts caller silently
--     falls back to the hash POOL preset on failed/timeout, so the
--     customer always gets *something* on the cup.
--   • slot_key is "{clientLineId}:{cupIdx}" — same key the cart uses
--     to attach doodles to lineItems in payment/route.ts.

create table cup_label_ai_jobs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  slot_key    text not null,
  prompt      text not null,
  status      text not null check (status in ('pending', 'ready', 'failed')),
  png_path    text,
  error       text,
  created_at  timestamptz not null default now(),
  ready_at    timestamptz,
  unique (user_id, slot_key)
);

create index cup_label_ai_jobs_pending_idx
  on cup_label_ai_jobs (status, created_at)
  where status = 'pending';

alter table cup_label_ai_jobs enable row level security;
-- service-role-only access; no client policies.
