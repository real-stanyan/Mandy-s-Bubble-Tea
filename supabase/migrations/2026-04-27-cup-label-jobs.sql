-- New per-cup CloudPRNT job table for TSP100IV SK pipeline.
-- Lives ALONGSIDE existing print_jobs (ZD411/ZPL path) — does not replace it.
-- See docs/superpowers/specs/2026-04-27-checkout-doodle-cup-label-design.md

create table if not exists cup_label_jobs (
  id                uuid primary key default gen_random_uuid(),
  square_order_id   text not null,
  line_id           text not null,
  cup_idx           int  not null,
  sticker_number    text not null,
  drink_name        text not null,
  modifiers_text    text not null,
  doodle_source     text not null check (doodle_source in ('user','default')),
  doodle_pool_key   text,
  doodle_paths      jsonb,
  raster_path       text not null,
  status            text not null default 'pending'
                       check (status in ('pending','printing','printed','failed')),
  attempts          int  not null default 0,
  last_error        text,
  printer_token     text,
  created_at        timestamptz not null default now(),
  printed_at        timestamptz,
  unique(square_order_id, line_id, cup_idx)
);

create index if not exists cup_label_jobs_status_created_idx
  on cup_label_jobs (status, created_at);

create index if not exists cup_label_jobs_order_idx
  on cup_label_jobs (square_order_id);

alter publication supabase_realtime add table cup_label_jobs;

alter table cup_label_jobs enable row level security;
-- service-role-only access; no client policies.
